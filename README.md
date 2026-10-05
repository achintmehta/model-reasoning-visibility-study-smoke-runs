# Smoke runs — study 42: does a coding agent's model need to re-read its own reasoning?

This repository holds the **certifying smoke set** of study 42: 66 short agent runs, made on
2026-10-04, that check the whole pipeline (models, server, harness, arms, logging) before the
pre-registered grid is run. Every run here was made with the frozen harness and server settings
the grid will use, and the set was checked by the gate script included here (`verify_smokes.py`).

**These runs are not study data.** The protocol excludes every smoke and probe run from
analysis by design; they are published so that the settings the study froze can be checked
against what the runs actually did.

## The study in one paragraph

An AI coding agent is a language model inside a harness. Before each action the model writes a
private scratchpad (its reasoning). On the next step the harness either shows the model its own
earlier reasoning again or throws it away. The study measures whether that matters, using three
arms per model:

| arm | thinking | earlier reasoning shown again? | run-id digit |
|---|---|---|---|
| OFF | switched off | — | `1` |
| UNSEEN | on | no, discarded after each step | `2` |
| SEEN | on | yes, replayed in the conversation | `3` |

gpt-oss-20b and Muse Glimmer 30B have no off-switch, so they run UNSEEN and SEEN only.

## Related records

| what | where |
|---|---|
| harness (the agent, the run wrappers, the tasks and rubrics) | not public; its code at commit `600a8d2565226c220b3db6c5e44511fc78277fca` (tag `model-reasoning-visibility-study-freeze-100426`) is archived with the OSF registration. Every run records this commit as `harness_git` in its `manifest.json` |
| protocol and study plan | the OSF pre-registration of study 42 (link to be added) |
| these smoke runs | this repository, `github.com/achintmehta/model-reasoning-visibility-study-smoke-runs` |
| grid data | to be deposited on Zenodo when the grid is complete |

## Layout

```
smoke-runs/
├── README.md                 this file
├── verify_smokes.py          the gate script that certified this set
├── verify_smokes_result.txt  its output on this set
├── decoding-registry.json    the per-model sampling settings the runs were checked against
├── batch-state/              the batch runner's schedule and progress records
└── <model>/                  one folder per model (8)
    └── <task>/               message-board | kanban-board
        └── <condition>/      no_verification | execution | interactive
            ├── runs/<id>/    the run that counts for this slot
            └── failed-attempts/<id>.attemptN/   earlier attempts of the slot, if any
```

### Models

| folder | model | arms | smoke runs |
|---|---|---|---|
| `gemma-q4` | Gemma-4-31B-it (Google), dense | 3 | 9 |
| `qwen-q4` | Qwen3.6-27B (Alibaba), dense | 3 | 9 |
| `seed-q4` | Seed-OSS-36B-Instruct (ByteDance), dense | 3 | 9 |
| `gptoss-20b` | gpt-oss-20b (OpenAI), mixture-of-experts | 2 | 6 |
| `glm-q4` | GLM-4.7-Flash (Zhipu), mixture-of-experts | 3 | 9 |
| `qwen-moe-q4` | Qwen3.6-35B-A3B (Alibaba), mixture-of-experts | 3 | 9 |
| `gemma-moe-q4` | Gemma-4-26B-A4B-it (Google), mixture-of-experts | 3 | 9 |
| `muse-q4xl` | Muse Glimmer 30B (Meta), dense | 2 | 6 |

All were served as ~4-bit GGUF builds by llama.cpp's `llama-server` (build b10964) on one
NVIDIA RTX PRO 6000 Blackwell machine. The folder name is the run wrapper's model key.

### Tasks

`message-board` and `kanban-board` are the two apps the agent is asked to build from a written
spec (a real-time message board, and a collaborative kanban board), each with a Node.js
backend using PGlite and a browser frontend. The specs are part of the harness archive on OSF
(`tasks/`).

### Conditions

The condition sets which tools the agent has:

| condition | tools |
|---|---|
| `no_verification` | read, write and edit files; list folders; finish. Nothing runs; the harness installs dependencies after the run, for grading |
| `execution` | the above, plus a terminal: run commands, start and stop background commands |
| `interactive` | the above, plus a headless browser driven through text (page structure, page text, console errors; no pixels) |

### Run ids

A run's folder name is the arm digit followed by the replicate number: `101` is OFF replicate 1,
`201` UNSEEN replicate 1, `301` SEEN replicate 1. The smoke has one replicate per slot, so
every id ends in `01`. Each arm of each model appears three times, spread across the six
task × condition cells, so no cell contains every arm.

## Inside a run: `runs/<id>/`

### `app/` — the workspace the agent built

This is the agent's working folder exactly as the run left it: the source it wrote, its
`package.json` and `package-lock.json` files, and anything its commands created.

| item | what it is |
|---|---|
| source files | what the agent wrote; this is what is graded |
| `package-lock.json` | the exact dependency versions installed; `npm ci` rebuilds `node_modules` from it |
| `.agent_logs/cmd_out_<time>.log` | output of the commands the agent ran in the background (servers, watchers), written by the harness so it stays out of the app's own files |
| `data/`, `pgdata/`, and similar | PGlite database folders created when the agent's app ran. Grading deletes them before starting the app |
| `node_modules/` | **not included** (see `.gitignore`); rebuild with `npm ci` in each folder that has a lockfile |

### `smoke/logs/` — what happened during the run

| file | what it records |
|---|---|
| `manifest.json` | the run's summary: model, arm, condition, decoding settings and their source, the harness commit (`harness_git`), prompt and task hashes, start and end times, terminal `status`, step count, token totals, reasoning counts, tool-call counts and malformations, retries, loop-guard firings, and a fingerprint of the final workspace |
| `trace.jsonl` | every exchange with the model, one JSON object per line: each `request` (the full conversation sent), each `response` (content, reasoning, tool calls, token usage) and each `tool_result`. The one trace over 100 MB (`glm-q4/kanban-board/execution/runs/301`) is stored compressed, as `trace.jsonl.zst` |
| `console.log` | the agent's console output: its command line, start-up checks (server, served model file, template hash), and a step-by-step account of reasoning, tool calls and results |
| `commands.json` | each tool call in order: step, tool and the start of its arguments |
| `environment.txt` | the toolchain the run saw: Node and npm versions, npm's registry freeze date, Python, Chromium, the llama-server build, the GPU and the WSL kernel |
| `llama-server.log.zst` | the model server's log at its most detailed level (`-lv 5`), zstd-compressed (1.87 GB of logs in all, 98 MB compressed). It opens with the server's exact command line, and for each request it keeps the prompt the server rendered from the chat template and the model's raw output before parsing. Read it with `zstd -dc llama-server.log.zst \| less` |

`smoke/screenshot/` is empty: the browser in `interactive` is text-only, so no screenshots
are taken.

A few values in the logs are local to the machine that made them and are not secrets:
`base_url` is a LAN address, and `--api-key lm-studio` is a placeholder that llama-server
ignores.

## Failed attempts: `failed-attempts/<id>.attemptN/`

If a run ends in an infrastructure failure (for example the server returning an error), the
batch runner moves the attempt here, with the same `app/` and `smoke/logs/` contents, and runs
the slot again with the same seed. The run that finally counts stays in `runs/<id>/`. In this
set only one slot has failed attempts: `gptoss-20b/kanban-board/execution`, where gpt-oss's
output could not be parsed by the server three times in a row, identically each time (the
same prompt and seed give the same tokens). Its last attempt is recorded as a **void**, which
is within the ceiling the protocol allows (gate G14).

## `batch-state/` — the batch runner's records

| file | contents |
|---|---|
| `schedule-smoke-<models>.tsv` | the frozen run order, one run per line: sequence number, model, task, condition, arm, run id, label |
| `schedule-smoke-<models>.sig` | a sha256 signature of the configuration the schedule was generated from (arm map, tasks, conditions, replicates and the runner script itself); the runner refuses to continue a schedule whose signature no longer matches |
| `progress-smoke-<models>.tsv` | one line per attempt: sequence number, outcome (`done`, `failed` or `void`), attempt number, exit code, run id, timestamp |
| `batch.log` | the runner's log: which model files were found, the schedule's hash, and the start of every run and attempt |

The paths inside these files are those of the machine that made the runs (`/mnt/d/...`, and
`/tmp/runs/smokes/...` where the runs were written before being copied here).

## Checking the set: `verify_smokes.py`

`verify_smokes.py` runs the protocol's pre-freeze gates (G1–G18) over every run in a folder:
that each arm sent and replayed what it should, that the OFF arm did not think, that the
thinking arms did, that every run used the same frozen harness, prompts, decoding settings,
token budget and server flags, that failures are attributed, and so on. Each gate is described
at the top of the script. It reads `llama-server.log` and `trace.jsonl` whether plain or
`.zst`-compressed, and needs Python 3.10+ and the `zstd` command.

```bash
python3 verify_smokes.py . --decoding-registry decoding-registry.json
python3 verify_smokes.py . --decoding-registry decoding-registry.json --verbose   # also every run's numbers
```

Gate G15 compares each run's sampling settings with `decoding-registry.json`, a copy of the
harness's file at the frozen commit, included here so the check runs without the harness. Its
sha256 begins `d3149737912ebbde`, the value every run records as `decoding_registry_sha`.
Without `--decoding-registry`, G15 reports that it cannot check. The exit status is the number
of failed gates.

On this set all gates pass, one of them by a waiver registered in the protocol: **G9** (token
budget). One GLM-4.7-Flash SEEN run (`glm-q4/kanban-board/execution/runs/301`) reached the
20M-token budget while each of its last 30 calls repeated one it had already made; reaching the
budget while looping is an outcome, not a censored run. The gpt-oss void described above is
within G14's ceiling, and no run overflowed its context window.

## What is not here

- `node_modules/` folders, which are rebuilt from each lockfile with `npm ci`.
- The blind-grading key, which stays private until grading of the grid is finished. Smoke runs
  are not graded.
