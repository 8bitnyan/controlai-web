# Serial Provisioning Protocol

Transport: ASCII line protocol over Web Serial (115200, 8N1, no flow control), `\n` terminated.

## Grammar
- Host commands: `INFO`, `SET group_id <value>`, `SET endpoint <value>`, `WRITE <path> <byteCount>`, `COMMIT`, `REBOOT`
- Device replies: `OK`, `OK <sha256-hex>`, `READY`, `ERR <message>`
- Device boot/log lines: must start with `# ` and are ignored by host.

## WRITE paths
- `/etc/controlai/ca.pem`
- `/etc/controlai/cert.pem`
- `/etc/controlai/key.pem`

## Timeouts
- Default command timeout: 10s
- `WRITE` and `REBOOT`: 60s

## Example transcript
```
> INFO
< {"model":"gw-v2","fw_version":"1.4.0","mac":"AA:BB:CC:DD:EE:FF","group_id":"old","ready":true}
< OK
> SET group_id gw-main-01
< OK
> SET endpoint mqtts://api.example.com:8883
< OK
> WRITE /etc/controlai/cert.pem 1234
< READY
> [1234 raw bytes]
< OK 4f2f...c9
> COMMIT
< OK
> REBOOT
< OK
```

## Error matrix
- `ERR invalid path` on WRITE path mismatch
- `ERR short write` when fewer bytes than declared are received
- `ERR parse` on malformed command
- `ERR busy` when device not ready to stage

## Future extension notes
- Optional capability negotiation can be added via `INFO` fields.
- Reserved for future: chunked WRITE, auth challenge, baud negotiation.
