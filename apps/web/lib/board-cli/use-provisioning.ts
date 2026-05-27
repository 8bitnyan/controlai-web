'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { trpc } from '@/lib/trpc/client';
import {
  BOARD_SERIAL_OPTIONS,
  BOARD_PROVISION_SEQUENCE,
  BOARD_PROBE_TIMEOUT_MS,
  BOARD_BOOT_TIMEOUT_MS,
  BOARD_CLOSE_TIMEOUT_MS,
  BOARD_OPEN_SETTLE_DELAY_MS,
  BOARD_INTER_CHUNK_DELAY_MS,
  BOARD_CHUNKED_SUCCESS_REGEX,
  BOARD_DEFAULT_FAILURE_REGEX,
  buildSingleCommandLine,
  type BoardCliCommand,
} from '../../../../packages/api/src/lib/board-cli-spec';
import { CliSession, CliTimeoutError } from './cli-session';
import {
  getSerialPortAdapter,
  PORT_REQUEST_CANCELLED,
  type SerialPortHandle,
} from './serial-port-adapter';
import {
  INITIAL_STATE,
  provisioningReducer,
  type ProvisioningState,
  type ProvisioningStep,
} from './provisioning-reducer';

function mapItemToStep(itemId: BoardCliCommand['itemId']): ProvisioningStep {
  switch (itemId) {
    case 'group_id':
      return 'SENDING_GROUP_ID';
    case 'broker':
      return 'SENDING_BROKER';
    case 'certca':
      return 'SENDING_CERTCA';
    case 'certclient':
      return 'SENDING_CERTCLIENT';
    case 'certkey':
      return 'SENDING_CERTKEY';
    case 'reboot':
      return 'REBOOTING';
  }
}

export function useProvisioning(gatewayId: string, orgId: string): {
  state: ProvisioningState;
  start: () => Promise<void>;
  retry: () => void;
  cancel: () => Promise<void>;
} {
  const [state, dispatch] = useReducer(provisioningReducer, INITIAL_STATE);
  const utils = trpc.useUtils();
  const recordSuccess = trpc.gateway.recordProvisionSuccess.useMutation();
  const recordFailure = trpc.gateway.recordProvisionFailure.useMutation();
  const sessionRef = useRef<CliSession | null>(null);
  const handleRef = useRef<SerialPortHandle | null>(null);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef<string[]>([]);

  const cleanup = useCallback(async () => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    sessionRef.current = null;
    handleRef.current = null;

    if (session) {
      await session.dispose().catch(() => undefined);
    }
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }, []);

  const start = useCallback(async () => {
    dispatch({ type: 'START_REQUESTING_PORT' });
    startTimeRef.current = Date.now();
    completedRef.current = [];
    let currentStep: ProvisioningStep = 'REQUESTING_PORT';

    try {
      const bundle = await utils.gateway.getProvisioningBundle.fetch({ orgId, gatewayId });
      const adapter = getSerialPortAdapter();
      const handle = await adapter.requestPort();
      handleRef.current = handle;
      dispatch({ type: 'PORT_ACQUIRED' });

      currentStep = 'OPENING_PORT';
      await handle.open(BOARD_SERIAL_OPTIONS);
      await new Promise<void>((resolve) => setTimeout(resolve, BOARD_OPEN_SETTLE_DELAY_MS));
      dispatch({ type: 'PORT_OPENED' });

      const session = new CliSession(handle);
      sessionRef.current = session;
      session.on('line', (line) => dispatch({ type: 'CONSOLE_LINE_APPENDED', line }));

      currentStep = 'PROBING';
      try {
        await session.sendCommand('', { timeoutMs: BOARD_PROBE_TIMEOUT_MS });
        dispatch({ type: 'PROBE_SUCCEEDED' });
        completedRef.current.push('PROBING');
      } catch (error) {
        if (error instanceof CliTimeoutError) {
          dispatch({ type: 'PROBE_TIMED_OUT_NEEDS_BOOT' });
          currentStep = 'BOOTING_APP';
          await session.sendCommand('boot', { timeoutMs: BOARD_BOOT_TIMEOUT_MS });
          dispatch({ type: 'BOOT_COMPLETED' });
          completedRef.current.push('BOOTING_APP');
        } else {
          throw error;
        }
      }

      currentStep = 'READING_DEVICE_INFO';
      let deviceSerial: string | undefined;
      try {
        const statusLines = await session.sendCommand('status', { timeoutMs: 2000 });
        const match = statusLines.join('\n').match(/serial[:=\s]+([A-Za-z0-9-]+)/i);
        deviceSerial = match?.[1];
      } catch {
        // best-effort
      }
      dispatch({ type: 'DEVICE_INFO_READ', deviceSerial });
      completedRef.current.push('READING_DEVICE_INFO');

      for (const cmd of BOARD_PROVISION_SEQUENCE) {
        const stepName = mapItemToStep(cmd.itemId);
        currentStep = stepName;
        dispatch({ type: 'ITEM_STARTED', step: stepName });

        if (cmd.kind === 'single') {
          const value = cmd.itemId === 'group_id' ? bundle.groupId : bundle.endpointURL;
          await session.sendCommand(buildSingleCommandLine(cmd, value), {
            timeoutMs: 5000,
            failureRegex: BOARD_DEFAULT_FAILURE_REGEX,
          });
        } else if (cmd.kind === 'chunked') {
          const hex =
            cmd.itemId === 'certca'
              ? bundle.rootCaHex
              : cmd.itemId === 'certclient'
                ? bundle.clientCertHex
                : bundle.clientKeyHex;

          await session.sendCommand(cmd.openCommand, {
            timeoutMs: 5000,
            failureRegex: BOARD_DEFAULT_FAILURE_REGEX,
          });

          for (let index = 0; index < hex.length; index += 1) {
            await session.writeLine(hex[index]!);
            dispatch({ type: 'CHUNK_PROGRESS', sent: index + 1, total: hex.length, itemId: cmd.itemId });
            if (index < hex.length - 1) {
              await new Promise<void>((resolve) => setTimeout(resolve, BOARD_INTER_CHUNK_DELAY_MS));
            }
          }

          await session.sendCommand(cmd.closeCommand, {
            timeoutMs: BOARD_CLOSE_TIMEOUT_MS,
            successRegex: BOARD_CHUNKED_SUCCESS_REGEX,
            failureRegex: BOARD_DEFAULT_FAILURE_REGEX,
          });
        } else {
          await session.writeLine(cmd.command);
          dispatch({ type: 'REBOOT_SENT' });
          completedRef.current.push('REBOOTING');
          continue;
        }

        dispatch({ type: 'ITEM_COMPLETED', step: stepName });
        completedRef.current.push(stepName);
      }

      await recordSuccess.mutateAsync({
        orgId,
        gatewayId,
        deviceSerial,
        durationMs: Date.now() - startTimeRef.current,
        completedSteps: completedRef.current,
      });

      await cleanup();
    } catch (error) {
      if (error === PORT_REQUEST_CANCELLED) {
        dispatch({ type: 'RESET' });
        return;
      }

      const reason = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'STEP_FAILED', step: currentStep, reason });

      try {
        await recordFailure.mutateAsync({
          orgId,
          gatewayId,
          durationMs: Date.now() - startTimeRef.current,
          stepReached: currentStep,
          failureReason: reason,
        });
      } catch {
        // swallow
      }

      await cleanup();
    }
  }, [cleanup, gatewayId, orgId, recordFailure, recordSuccess, utils.gateway.getProvisioningBundle]);

  const retry = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const cancel = useCallback(async () => {
    await cleanup();
    dispatch({ type: 'RESET' });
  }, [cleanup]);

  useEffect(() => {
    const active = !['IDLE', 'DONE', 'ERROR'].includes(state.step);
    if (!active) {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.step]);

  // integration test deferred — covered by Playwright e2e in Phase F
  return { state, start, retry, cancel };
}
