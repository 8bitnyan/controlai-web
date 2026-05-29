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
    case 'status':
      return 'READING_DEVICE_INFO';
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
      // Wait specifically for the application CLI prompt (`CLI>`).
      // If we see `bootloader>` we must wait for auto-boot (~2s) to complete and the app
      // to emit `CLI>` — firing commands at the bootloader prompt fails with
      // "bootloader> Unknown command: 'group_id'".
      const PROBE_DEADLINE_MS = 20000; // 20s — covers bootloader countdown + app init
      const sawAppPrompt = await new Promise<boolean>((resolve) => {
        let done = false;
        let sawBootloader = false;
        const off = session.on('line', (line: string) => {
          if (done) return;
          if (/^CLI>/i.test(line.trim())) {
            done = true;
            off();
            resolve(true);
            return;
          }
          if (/^bootloader>/i.test(line.trim())) {
            sawBootloader = true;
            // Do not respond — let auto-boot proceed.
          }
        });
        setTimeout(() => {
          if (done) return;
          done = true;
          off();
          resolve(false);
        }, PROBE_DEADLINE_MS);
        // Nudge once: a bare newline often makes idle firmwares re-emit their prompt.
        // But ONLY nudge if we have NOT seen bootloader prompt — pressing keys during
        // bootloader countdown aborts auto-boot.
        setTimeout(() => {
          if (done || sawBootloader) return;
          session.writeLine('').catch(() => undefined);
        }, 500);
      });
      if (!sawAppPrompt) {
        throw new Error(
          '애플리케이션 CLI 프롬프트(CLI>)를 받지 못했습니다. 보드가 bootloader 모드에 멈춰 있거나 부팅이 실패했습니다. 보드를 리셋하고 재시도하세요.',
        );
      }
      dispatch({ type: 'PROBE_SUCCEEDED' });
      completedRef.current.push('PROBING');

      // Halt gateway runtime logic so it does not interfere with provisioning commands.
      // Firmware advertises: "Gateway starts in 5s. Type 'stop' for manual mode."
      try {
        await session.sendCommand('stop', {
          timeoutMs: 3000,
          successRegex: /\b(stopped|manual|ok)\b/i,
        });
      } catch {
        // best-effort — if `stop` is not recognized on this firmware variant, proceed anyway
      }

      currentStep = 'READING_DEVICE_INFO';
      let deviceSerial: string | undefined;
      try {
        const statusLines = await session.sendCommand('status', {
          timeoutMs: 3000,
          successRegex: /board id:/i,
        });
        const match = statusLines.join('\n').match(/board id:\s*([A-Za-z0-9-]+)/i);
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
            timeoutMs: 8000,
            successRegex: /\b(set to:|saved|ok)\b/i,
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
