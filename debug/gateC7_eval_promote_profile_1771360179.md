# Gate C7 Eval/Promote IPC Profile (short canonical probe)

Date: 2026-02-17
Run id: 1771360142
Contract: `promote_best.py --eval-only --eval-episodes 4 --eval-max-steps 400`

## Results

Iteration 1 (`run id 1771360114`):
- legacy real time: `6.13s`
- compact real time: `5.80s`
- compact delta: `+5.4%` faster

Iteration 2 (`run id 1771360142`):
- legacy real time: `5.98s`
- compact real time: `5.73s`
- compact delta: `+4.2%` faster

Both transports produced identical eval metrics/score payloads.

## Interpretation

On short eval/promote windows where IPC/setup overhead is visible, compact path keeps score parity and provides a small but consistent runtime gain (~4-5%).
