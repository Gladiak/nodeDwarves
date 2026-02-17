# Gate C7 Throughput Compare (C7 patch vs Gate C+ baseline)

Date: 2026-02-17
Run id: 1771360142

## Baseline reference

Source snapshot: `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` (Validation snapshot 2026-02-17).

- Profile A baseline (`30x140`, workers `4`, seed `4242`): `legacy=175.0 eps_pm`
- Profile B baseline (`120x25`, workers `8`, seed `4242`): `legacy=635.6 eps_pm`

## C7 candidate measurements

Conservative candidate (`legacy`, patched trainer/server):

- Profile A: `266.4 eps_pm`
  - delta vs Gate C+ baseline: `+52.2%`
- Profile B: `1175.8 eps_pm`
  - delta vs Gate C+ baseline: `+85.0%`

## IPC hotspot notes

From final `thr[...]` windows in C7 profile logs:

- Profile A legacy: `env=5.89ms`, `ipc_r=5.82ms`, `ipc_w=0.02ms`, `ipc_p=0.04ms`
- Profile B legacy: `env=13.79ms`, `ipc_r=13.69ms`, `ipc_w=0.03ms`, `ipc_p=0.07ms`

Interpretation: step latency is read/engine dominated (`ipc_r` near `env`), while Python parse/write overhead is already marginal.
