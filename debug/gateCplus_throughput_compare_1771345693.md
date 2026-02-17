# Gate C+ Throughput Compare (Compact vs Legacy)

Date: 2026-02-17
Run id: `1771345693`

## Profile A (quality-like microcycle)

Contract:
- episodes `30`
- max steps `140`
- step ticks `4`
- workers `4`
- seed `4242`

Result (`eps_pm` @ final window):
- legacy: `175.0`
- compact: `207.4`
- delta: `+18.5%`

## Profile B (IPC-heavy probe)

Contract:
- episodes `120`
- max steps `25`
- step ticks `2`
- workers `8`
- seed `4242`

Result (`eps_pm` @ final window):
- legacy: `635.6`
- compact: `653.9`
- delta: `+2.9%`

## Notes

- Same config, same seed, same episode budget and worker count.
- Only transport mode changed (`legacy` vs `compact`).
- Throughput improves on both probes but does not reach the Gate C+ target (`>= +25%`).
