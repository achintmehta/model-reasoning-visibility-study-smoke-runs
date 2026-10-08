#!/usr/bin/env python3
"""verify_smokes.py — run the §9 pre-freeze gates over a tree of runs.

    python3 verify_smokes.py /mnt/d/quantization_research_runs/smoke
    python3 verify_smokes.py <root> --verbose      # also print every run's numbers

This is the checklist in executable form. Eyeballing a 42-row table is how a null
treatment survives to the grid: "no reasoning was replayed" and "there was no reasoning
to replay" look identical in a totals column, and an arm can be silently dead while
every run says `finished`. Each gate below is one of those failure modes, written so it
fails loudly rather than reading fine.

GATES

  G1  arm ↔ replay          SEEN must record reasoning_replayed=true; UNSEEN and OFF
                            false. The OFF arm is replay-off by rule, not by default
                            (plan §4.2.1), so an OFF run recording true is a run made
                            with the old wrapper.
  G2  OFF canary (length)   No step in an OFF run may carry a reasoning field longer
                            than OFF_MAX chars. Presence alone is NOT the test: a
                            template can emit a fixed stub while the model is not
                            thinking — Seed-OSS's budget-reflect stub is ~133 chars.
                            Nor is a field that IS a tool call (plan v2.5.5, §9 item 2):
                            the arguments of one of the harness's tools, or nothing but
                            tool-call markup, is a call filed in the wrong field, not
                            thinking. It is set aside, listed, and counted as callTxt.
                            Nor, since v2.5.37, are Seed-OSS's budget reports: a
                            `<seed:cot_budget_reflect>` block is the template's report of
                            the thinking budget, not thought, and once reasoning left in the
                            reply text is counted (G4) a report split between the field and
                            the text measured 229 chars. G2 measures without them.
                            WAIVED for Gemma-4-26B-A4B (plan v2.5.12, v2.5.14): its OFF
                            arm is kept and watched, so its over-length OFF runs are
                            listed under the waiver; any other model's fail the gate.
  G3  ON canary (length)    Every UNSEEN/SEEN run must carry at least one step over
                            OFF_MAX chars, and must reason on at least ON_MIN_RATE of
                            its steps. The rate floor is deliberately low: a model that
                            reasons on only a third of its UNSEEN steps is showing a
                            real downstream effect, not a broken manipulation.
  G4  no reasoning leak     No step's reply text, as the harness kept and replayed it,
                            may carry a think or channel marker -- opening OR closing
                            (plan v2.5.37) -- or, since v2.5.38, any roster template's
                            turn-structure marker (<|im_end|>, <turn|>, <|end|>, ...),
                            which would mean the server mis-split the output. A marker there means reasoning sits in the
                            visible text, where the UNSEEN arm cannot strip it and the
                            manipulation is null. Since v2.5.37 the harness moves reasoning
                            the server left in the text (a closing tag with no opening one,
                            Seed-OSS's habit in UNSEEN) to the reasoning field, so a marker
                            still in the kept text is a split the harness missed. A run made
                            before v2.5.37 fails here wherever that happened. The recovered
                            reasoning is recomputed here, independently of the harness, and
                            counted as reasoning by G2, G3 and the descriptives (`recov`).
                            A split made at an OPENING tag never closed assumes the
                            thought ran to the end of the reply -- the one case where
                            where it ended is inferred, not marked -- so those steps are
                            counted apart (`atOpen`) and listed for checking by hand
                            (v2.5.38).
  G5  preamble ↔ arm        think_preamble_key must be "none" in OFF and identical
                            across a model's two thinking arms — the primary contrast
                            must not vary the system prompt.
  G6  frozen inputs         base_prompt_sha, condition_briefing_sha and harness_git
                            identical across the whole set; task_sha identical per task.
  G7  provenance            quantization_detail.status == ok on every run.
  G8  body ↔ arm            extra_body identical across a model's two thinking arms.
  G9  budget headroom       report the peak total tokens against BUDGET and fail if any
                            run exceeded it or came within HEADROOM of it. WAIVED for a
                            run that reached the budget while looping (plan v2.5.14):
                            token_budget_exhausted, with its last LOOP_TAIL calls at most
                            LOOP_DISTINCT distinct once numbers are masked, OR (plan
                            v2.5.34) with every one of its last LOOP_TAIL calls, numbers
                            masked, a call it had already made earlier in the run -- the
                            harness's no-progress definition, with pids and timestamps
                            masked. That run is an outcome, not one the budget cut short.
                            And (plan v2.5.39) for a run the study lead JUDGED stuck, listed
                            in G9_JUDGED with its evidence: the waiver holds only for the same
                            trajectory (trace fingerprint); a different one is judged again.
  G17 server flags         (plan v2.5.24, v2.5.26, v2.5.27) every run's llama-server.log
                            banner carries EXACTLY the frozen serving flags, FROZEN_SERVER_ARGS
                            (--swa-full and -lv 5 included), plus any per-model flags in
                            EXPECTED_SERVER_FLAGS (none now) -- -m, -c, --alias and --port
                            aside. A flag missing, added or changed fails, so a run made with
                            NO_SWA_FULL=1, NO_MODEL_SERVER_FLAGS=1 or another SERVER_VERBOSITY
                            fails here.
  G18 overflow is an outcome (plan v2.5.28) a request the server refused for outgrowing
                            the context window ends the run as context_overflow, an outcome
                            the batch never re-runs. Fails if any run or kept failed attempt
                            is an api_error whose body is such a refusal: an overflow filed as
                            a fault (a harness before v2.5.28), which the batch would retry.
                            context_overflow runs are counted per model x arm, not failed.
  G16 no re-rolled timeout  (plan v2.5.8) No run may record a TIMEOUT retry in its
                            api_retries: a timed-out call is re-sent and regenerated from
                            zero, and a timeout falls on exactly the longest replies, so a set
                            containing one has had its longest replies silently replaced.
                            A run with no api_retries field fails too -- it was made before
                            retries were recorded -- unless --no-retry-record is passed.
                            Other retries are listed, not failed.

A WAIVED gate (plan v2.5.14) is one the study lead has decided on the record: it prints WAIVE
with what was waived and why, it does not count as failed, and the last line says how many
gates passed only by a waiver -- so a waiver is visible in every report, never silent.

DESCRIPTIVES are reported, never gated. Since plan v2.5.9 the last of them counts EVERY
attempt: the batch driver keeps each failed smoke attempt under <condition>/failed-attempts/,
and the table counts those with the slots in runs/, per model x arm and by cause, printing what
the model wrote whenever its server could not parse it. Since plan v2.5.11 it also tells a
REPLAY -- an attempt byte-identical, response for response, to another attempt of its slot --
from a new failure, and counts distinct failed trajectories beside the attempts.

COMPRESSED LOGS

A run's llama-server.log and trace.jsonl may be stored zstd-compressed, as
llama-server.log.zst and trace.jsonl.zst (the published smoke-runs are). Each is read
from the plain file when it exists and from the .zst otherwise, decompressed as it is
read, so the gates see the same lines either way. Decoding uses the `zstd` command,
else the zstd module of Python 3.14+; with neither, or with a damaged .zst, the check
stops with an error rather than reading the log as missing or short.

Exit status is the number of failed gates, so this can gate a script.
"""
import argparse
import contextlib
import hashlib
import io
import json
import re
import shutil
import subprocess
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

OFF_MAX = 200          # chars of reasoning; above this is thinking, below is boilerplate
ON_MIN_RATE = 0.20     # a thinking arm must reason on at least this share of its steps
# Raised from 8M on 2026-09-23, and from 12M on 2026-09-26 (plan v2.5.12, §4.4). G10 requires
# ONE value across a set, so a set spanning a change fails it -- correctly: that is the gate
# reporting a mixed configuration, not a false alarm. Verify an older set by passing
# --budget 12000000, or --budget 8000000 for the sets made before 2026-09-23.
BUDGET = 20_000_000    # MAX_TOTAL_TOKENS (plan §4.4)
HEADROOM = 0.80        # warn when a run exceeds this fraction of the budget
# plan v2.5.14 -- the registered waivers. Each is the study lead's decision on the record.
# plan v2.5.32: gpt-oss's unparseable-output voids are waived and watched, at the study lead's
# decision. In a smoke every retry replays the same prompt and seed, so one bad draw voids the
# whole slot; with --swa-full gpt-oss failed 6 of 24 distinct attempts across four sets, and in
# the grid each retry is a fresh draw. Its voids are still listed, counted per arm and reported.
G14_WAIVED = {"gptoss-20b": "gpt-oss's unparseable-output voids are waived and watched "
                            "(plan v2.5.32): in a smoke a retry replays the failure"}
G2_WAIVED = {"gemma-moe-q4": "Gemma-4-26B-A4B's OFF arm is waived and watched "
                             "(plan v2.5.12, v2.5.14)"}
# plan v2.5.39: JUDGED G9 waivers -- a run that reached the budget without meeting either
# looping rule, judged by the study lead to have been stuck, on the evidence recorded here.
# Keyed by slot; it holds only for the SAME trajectory (trace_fingerprint): a run of that slot
# that went differently must be judged again, so the gate fails it and says so.
G9_JUDGED = {
    "glm-q4/message-board/execution/201": {
        "fingerprint": "983e9b6b92b0ba8d",
        "judged": "2026-10-06 (plan v2.5.39): stuck from about step 100 -- in every 25-step block "
                  "after it, 56-92% of calls repeat a call already made (numbers masked); about "
                  "250 steps alternating between two PGlite import forms, restarting the server "
                  "and probing /health (41 times); its last reasoning reports the same import "
                  "error; 27 of its last 30 calls are repeats, so the automatic rule missed it",
    },
}
LOOP_TAIL = 30         # G9: the calls examined at the end of a run that reached the budget,
LOOP_DISTINCT = 3      # and at most this many distinct among them, numbers masked, is a loop
_NUM = re.compile(r"\d+")
ARM_OF = {"1": "OFF", "2": "UNSEEN", "3": "SEEN"}

# The body each model must send in each arm, stated INDEPENDENTLY of the run wrapper.
# Duplicating run_one_with_server.sh's think_body() here is deliberate, not an oversight:
# a gate that derives its expectation from the thing it is checking cannot catch a change
# to that thing. Two separate statements of the same fact, and a check that they agree.
# Edit this only together with the wrapper AND the plan's §4.2.2 tables.
#   preserve_thinking is present in all three arms for Gemma and Qwen: their templates gate
#   a past turn's visible reasoning on the position of the last user message, and the
#   harness's finish nudge is a user message, so without it SEEN silently truncates.
# top_k left these tables in v2.4.0 along with the samplers. It is NOT that the wrapper
# stopped sending it and this followed: the rule is stated in the plan (§4.4.1) -- the
# request body carries ONLY chat_template_kwargs, the template switch, which is the
# treatment, and every sampler is a flag whose value comes from decoding-registry.json and
# is checked separately by G15. So this table still says what the body OUGHT to be, derived
# from the plan rather than from what the wrapper emits, which is the only reason it can
# catch the wrapper being wrong.
_ENABLE = lambda on: {"chat_template_kwargs": {"enable_thinking": on,
                                               "preserve_thinking": True}}
# How each model must carry a replayed thought back (harness REPLAY_FORMATS). Magistral's
# template has no reasoning field; sending one makes llama.cpp delete the assistant's prose,
# so its SEEN arm would show the model less than UNSEEN. Stated here independently of the
# wrapper for the same reason EXPECTED_BODY is.
# Which registered thinking preamble each model's THINKING arms must carry ("none" where
# the model has no such switch). Magistral's is the trimmed 'mistral-min' rather than the
# vendor text, on 10 runs per variant: 100% vs 91% of steps reasoning, 0 vs 4 runs writing
# prose at step 1, 10 vs 9 finishing. A registered deviation from the model card.
# A run voided because the SERVER could not parse what the MODEL produced. gpt-oss speaks
# harmony and llama.cpp parses it with a PEG grammar; a malformed channel sequence comes
# back as HTTP 500 and the run dies. Matched on the recorded error BODY, not on the newer
# manifest flag, so this reads runs made before that flag existed.
#
# WHY THIS IS NOT ORDINARY DROPOUT. The probability of this void depends on what the model
# generated, and what the model generates is exactly what the ladder manipulates. So these
# runs are NOT missing at random: they are missing *because of the arm*, and pooling them
# away biases the contrast in a direction nothing in the data reveals. gpt-oss carries only
# two arms, so its single comparison is what gets eaten.
_UNPARSEABLE_RE = re.compile(
    r"peg[-\s]?native"
    r"|output\s+that\s+does\s+not\s+match\s+the\s+expected\s+\S+\s+format"
    r"|failed\s+to\s+parse\s+.{0,40}\b(?:harmony|channel)\b", re.I)

# A SMOKE CANNOT TEST BALANCE. Three runs per arm cannot distinguish 1-vs-0 from a real
# asymmetry, and a gate that failed on that would cry wolf on every set. So this gate tests
# the two things a smoke CAN answer -- is every failure attributed, and is the rate low
# enough that the model is usable at all -- and the per-arm counts are printed in the
# descriptives for the grid to be judged on. Balance is a grid-time question (plan §10).
# Sampling is per model and per thinking mode, and it lives in a config file rather than in
# code (plan §4.4.1). This gate reads THE SAME FILE the run wrapper reads and checks that
# what each run recorded is what the registry says for its model and arm. That is not a
# tautology: the wrapper reads the file, the harness is handed values and records what it
# was given, and this reads the file again and compares -- so a value lost between any two
# of those three points shows up here rather than in the results.
DECODING_REGISTRY = "../eval-coding-agent/decoding-registry.json"
ARM_MODE = {"OFF": "non_thinking", "UNSEEN": "thinking", "SEEN": "thinking"}
SAMPLERS = ("temperature", "top_p", "top_k", "min_p", "presence_penalty")


def load_decoding_registry(path):
    for cand in (path, Path(__file__).resolve().parent / DECODING_REGISTRY):
        if cand is None:
            continue
        try:
            return json.loads(Path(cand).read_text(encoding="utf-8")), str(cand)
        except (OSError, ValueError):
            continue
    return None, None


VOID_CEILING_NUM, VOID_CEILING_DEN = 1, 3   # a cell fails above 1/3 of its runs
# Integer arithmetic on purpose: with 3 runs per arm the interesting case sits exactly
# ON the boundary, and `1/3 > 1/3` being False is a fact about floats rather than a
# decision anyone made. 1-of-3 passes (noise), 2-of-3 fails (structural) -- stated, not
# inherited from IEEE 754.


def parse_void(man) -> bool:
    """True when this run died because the model's own output could not be parsed."""
    ae = (man or {}).get("api_error") or {}
    if ae.get("model_output_unparseable"):
        return True
    return bool(_UNPARSEABLE_RE.search(str(ae.get("body") or "")))


# plan v2.5.28: llama.cpp's refusal of a request that outgrew the window (HTTP 400).
_OVERFLOW_RE = re.compile(r"exceed_context_size_error|exceeds\s+the\s+available\s+context\s+size",
                          re.I)


def overflow_filed_as_error(man) -> bool:
    m = man or {}
    if (m.get("status") or m.get("terminal_status")) != "api_error":
        return False
    return bool(_OVERFLOW_RE.search(str((m.get("api_error") or {}).get("body") or "")))


def unexplained_api_error(man) -> bool:
    """An api_error we cannot attribute to a cause -- worse than one we can."""
    m = man or {}
    if (m.get("status") or m.get("terminal_status")) != "api_error":
        return False
    ae = m.get("api_error") or {}
    return not (ae.get("server_model_crash") or parse_void(m))


# plan v2.5.26: --swa-full is served to every model (v2.5.24 had it for gpt-oss only).
# EXPECTED_SERVER_FLAGS adds any flag one model alone needs (none now). Every flag named here
# is checked on EVERY run, so a flag missing, or leaking onto another model, fails G17.
DEFAULT_SERVER_FLAGS = ["--swa-full"]
EXPECTED_SERVER_FLAGS = {}
# plan v2.5.27: the whole frozen serving spec, in the wrapper's order, stated here
# INDEPENDENTLY of run_one_with_server.sh (as EXPECTED_BODY is), with -m, -c, --alias and
# --port taken out because they vary by model or are checked elsewhere.
FROZEN_SERVER_ARGS = ["-np", "1", "-ngl", "999", "-fa", "on", "-b", "2048",
                      "--cache-type-k", "f16", "--cache-type-v", "f16", "--jinja", "--swa-full",
                      "--seed", "0", "--host", "0.0.0.0", "-lv", "5"]
_VARYING_ARGS = {"-m", "-c", "--alias", "--port"}


def frozen_part(args):
    """The banner's args with -m, -c, --alias and --port (and their values) removed."""
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
            continue
        if a in _VARYING_ARGS:
            skip = True
            continue
        out.append(a)
    return out


ZST = ".zst"


@contextlib.contextmanager
def open_log(path):
    """Open a run's log for reading text, from `path` or, failing that, `path`.zst.

    Yields a text stream; a missing log raises FileNotFoundError (an OSError, as before).
    `path` may also name the .zst itself."""
    path = Path(path)
    if path.suffix == ZST:
        plain, packed = path.with_suffix(""), path
    else:
        plain, packed = path, path.with_name(path.name + ZST)
    if path.suffix != ZST and plain.exists():
        with open(plain, encoding="utf-8", errors="replace") as fh:
            yield fh
        return
    if not packed.exists():
        raise FileNotFoundError(f"neither {plain} nor {packed}")
    with _zst_text(packed) as fh:
        yield fh


@contextlib.contextmanager
def _zst_text(packed: Path):
    """Stream-decompress one .zst file as UTF-8 text (errors replaced).

    Uses the `zstd` command, else Python 3.14's compression.zstd. Both stop with an error
    on a truncated file. (The `zstandard` package is not used: its stream reader ends a
    truncated file quietly, so a damaged log would read as a short one.)"""
    exe = shutil.which("zstd")
    if not exe:
        try:                               # Python 3.14+
            from compression import zstd as _z
        except ImportError:
            raise RuntimeError(f"{packed} is zstd-compressed and nothing here can read it: "
                               "install zstd (apt install zstd), or use Python 3.14+") from None
        with _z.open(packed, "rt", encoding="utf-8", errors="replace") as fh:
            yield fh
        return
    proc = subprocess.Popen([exe, "-dcq", "--", str(packed)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    fh = io.TextIOWrapper(proc.stdout, encoding="utf-8", errors="replace")
    reached_end = False
    try:
        yield fh
        reached_end = fh.read(1) == ""     # False when the reader stopped early on purpose
    finally:
        if proc.poll() is None:
            if reached_end:            # all output read: let zstd exit on its own
                try:
                    proc.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    proc.kill()
            else:                      # the reader stopped early, or raised
                proc.kill()
        fh.close()
        err = proc.stderr.read().decode(errors="replace").strip()
        proc.stderr.close()
        proc.wait()
    if reached_end and proc.returncode != 0:
        # A truncated or corrupt .zst. Not an OSError on purpose: the readers treat an
        # OSError as "no log", and a damaged log must stop the check, not read as empty.
        raise RuntimeError(f"zstd could not decompress {packed}: {err or proc.returncode}")


def banner_args(run_dir):
    """The args line of the run's llama-server.log banner, as a list, or None."""
    log = Path(run_dir) / "smoke" / "logs" / "llama-server.log"
    try:
        with open_log(log) as f:
            for i, line in enumerate(f):
                if line.startswith("args:"):
                    return line[len("args:"):].split()
                if i > 40:
                    break
    except OSError:
        return None
    return None


EXPECTED_PREAMBLE = {
    "gemma-q4": "none", "qwen-q4": "none", "seed-q4": "none",
    "gptoss-20b": "none", "magistral-q4xl": "mistral-min",
    # Granite's switch is a template kwarg, not a system prompt, so no preamble in any arm.
    "granite-q4": "none",
    # GLM-4.7-Flash, the roster's sixth model as of plan v2.5.0: its switch is a template
    # kwarg, not a system prompt, so no preamble in any arm.
    "glm-q4": "none",
    # The mixture-of-experts twins of qwen-q4 and gemma-q4 (plan v2.5.2-v2.5.4): their
    # siblings' switch, so no preamble either.
    "qwen-moe-q4": "none", "gemma-moe-q4": "none",
    # Muse Glimmer 30B (plan v2.5.20): its switch is a template kwarg, reasoning_strength, so no
    # preamble in either arm.
    "muse-q4xl": "none",
}
EXPECTED_REPLAY_FORMAT = {
    "gemma-q4": "field", "qwen-q4": "field", "seed-q4": "field",
    "gptoss-20b": "field", "magistral-q4xl": "inline-think",
    # Granite's template reads msg.reasoning_content off the message and folds it into the
    # content as <think>…</think>, so the field route is right and no inline form is needed.
    # Confirmed on the live server, not inferred: the probe's SEEN prompt carried both
    # turns' reasoning with the assistant's own prose intact (+150 chars, matching the
    # offline render exactly).
    "granite-q4": "field",
    # GLM's template takes m.reasoning_content when it is a string (and only otherwise parses
    # a </think> out of the content) and renders it as <think>…</think> AHEAD of the prose, so
    # the field route is right. Confirmed on the live server 2026-09-25: SEEN carried both
    # turns' reasoning, UNSEEN none, the prose intact, +158 chars -- the offline delta exactly.
    "glm-q4": "field",
    # The twins serve their siblings' templates BYTE FOR BYTE (Qwen 55d4931433fe502b, Gemma
    # aa3185dfc6505104 as served), and the live probe rendered byte-identical prompts in all
    # three arms, so the sibling's route is the twin's.
    "qwen-moe-q4": "field", "gemma-moe-q4": "field",
    # Muse Glimmer's template renders each past turn's reasoning_content as its own `to=self`
    # message, for every assistant turn that carries one, with no flag. Confirmed on the live
    # server 2026-09-30: SEEN carried both turns' reasoning, UNSEEN none, +232 chars, and the
    # marker test came back ACCEPTED (plan v2.5.20).
    "muse-q4xl": "field",
}
EXPECTED_BODY = {
    "gemma-q4":       {"OFF": _ENABLE(False), "UNSEEN": _ENABLE(True), "SEEN": _ENABLE(True)},
    "qwen-q4":        {"OFF": _ENABLE(False), "UNSEEN": _ENABLE(True), "SEEN": _ENABLE(True)},
    # Seed's switch is a thinking budget, so only its OFF arm carries a kwarg; its thinking
    # arms take the template default and send an empty body.
    "seed-q4":        {"OFF": {"chat_template_kwargs": {"thinking_budget": 0}},
                       "UNSEEN": {}, "SEEN": {}},
    # Magistral's switch is the system preamble, not the body — so the body is empty in all
    # three arms, and that emptiness is itself the property worth pinning.
    "magistral-q4xl": {"OFF": {}, "UNSEEN": {}, "SEEN": {}},
    # gpt-oss has no off-switch: two arms, identical bodies, effort frozen at medium.
    "gptoss-20b":     {"UNSEEN": {"chat_template_kwargs": {"reasoning_effort": "medium"}},
                       "SEEN":   {"chat_template_kwargs": {"reasoning_effort": "medium"}}},
    # Granite shares Gemma's and Qwen's switch but names its keep-the-history flag
    # differently AND with the opposite polarity: truncate_history_thinking FALSE keeps a
    # past turn's reasoning, where preserve_thinking TRUE does. Sent in all three arms so
    # the only things moving across the ladder are enable_thinking and whether the
    # reasoning is replayed. Stated from the plan (§4.4.1, §5), not from the wrapper.
    "granite-q4":     {"OFF":    {"chat_template_kwargs": {"enable_thinking": False,
                                                           "truncate_history_thinking": False}},
                       "UNSEEN": {"chat_template_kwargs": {"enable_thinking": True,
                                                           "truncate_history_thinking": False}},
                       "SEEN":   {"chat_template_kwargs": {"enable_thinking": True,
                                                           "truncate_history_thinking": False}}},
    # GLM names its keep-the-history flag a third way, clear_thinking, with Granite's
    # polarity: FALSE keeps a past turn's reasoning. Its gate is a plain OR --
    # ((clear_thinking is defined and not clear_thinking) or loop.index0 > last_user_index) --
    # so FALSE shows every past turn whatever the finish nudge does, and leaving it UNSET
    # clears history. Sent in all three arms, as the other flags are. Stated from the plan
    # (§4.2.2, §5), not from the wrapper.
    "glm-q4":         {"OFF":    {"chat_template_kwargs": {"enable_thinking": False,
                                                           "clear_thinking": False}},
                       "UNSEEN": {"chat_template_kwargs": {"enable_thinking": True,
                                                           "clear_thinking": False}},
                       "SEEN":   {"chat_template_kwargs": {"enable_thinking": True,
                                                           "clear_thinking": False}}},
    # The twins take their siblings' THINK_KIND by construction, so their bodies are the
    # siblings' bodies -- stated here from the plan (section 5), not read from the wrapper.
    "qwen-moe-q4":    {"OFF": _ENABLE(False), "UNSEEN": _ENABLE(True), "SEEN": _ENABLE(True)},
    "gemma-moe-q4":   {"OFF": _ENABLE(False), "UNSEEN": _ENABLE(True), "SEEN": _ENABLE(True)},
    # Muse Glimmer 30B (plan v2.5.20) has no off-switch: two arms, identical bodies, reasoning
    # strength frozen at high, the template default and Meta's advice for agentic coding.
    "muse-q4xl":      {"UNSEEN": {"chat_template_kwargs": {"reasoning_strength": "high"}},
                       "SEEN":   {"chat_template_kwargs": {"reasoning_strength": "high"}}},
}
# plan v2.5.19: Muse Glimmer's reasoning is a separate message addressed `to=self`; if the
# server ever failed to split it off, that header is what the content would carry. No other
# model writes it, so it can only fire on Muse. What G4 should look for in general is still
# open (plan section 9, item 3b).
OPENERS = ("[THINK]", "<think>", "<seed:think>", "to=self")
# plan v2.5.37: G4 looks for every think marker, opening or closing, and the channel markers
# of Gemma 4 and gpt-oss, in the reply text as the harness KEPT it (the trace row's `text`,
# which is what was replayed). Stated here independently of the harness, as the other
# expectations are.
LEAK_MARKERS = OPENERS + ("[/THINK]", "</think>", "</seed:think>",
                          "<|channel>thought", "<channel|>", "<|channel|>", "<|message|>")
# plan v2.5.38: and each roster template's TURN-STRUCTURE markers. They are not reasoning,
# but one in the reply text means the server mis-split the model's output, which nothing
# else would notice. Qwen: <|im_start|> <|im_end|>; Gemma 4: <|turn> <turn|>; gpt-oss:
# <|start|> <|end|> <|return|> <|call|>; Muse Glimmer: <|start|> <|eot|> <|eom|>;
# GLM: <|system|> <|user|> <|assistant|> <|observation|>; Seed-OSS: <seed:bos> <seed:eos>.
TURN_MARKERS = ("<|im_start|>", "<|im_end|>", "<|turn>", "<turn|>",
                "<|start|>", "<|end|>", "<|return|>", "<|call|>", "<|eot|>", "<|eom|>",
                "<|system|>", "<|user|>", "<|assistant|>", "<|observation|>",
                "<seed:bos>", "<seed:eos>")
LEAK_MARKERS = LEAK_MARKERS + TURN_MARKERS
# plan v2.5.38: and Gemma 4's thought channel, `<|channel>thought ... <channel|>` (gpt-oss's
# channels are not split by the harness; G4 fails on them).
_THINK_CLOSE = ("</seed:think>", "</think>", "[/THINK]", "<channel|>")
# plan v2.5.37: Seed-OSS's thinking-budget report, which G2 does not count as reasoning.
_BUDGET_REPORT = re.compile(r"<seed:cot_budget_reflect>.*?</seed:cot_budget_reflect>", re.S)
# plan v2.5.39: Gemma's opening tag only WITH its name -- a bare `<|channel>` was a tool call
# with the wrong opener (2026-10-06), which stays in the reply and is counted as callTxt.
_THINK_OPEN = ("<seed:think>", "<think>", "[THINK]", "<|channel>thought")
_GEMMA_CHANNEL_OPEN = re.compile(r"<\|channel>(?:thought[ \t]*\n?)?")


def reasoning_split(text):
    """(recovered, kind, marker) for a reply's TEXT: the reasoning it carries -- everything
    before its last closing think tag, or after an opening tag never closed, tags removed --
    with kind "close" or "open" by which tag the split was made at, and that tag. All None
    when there is no tag. This is the rule the harness applies from v2.5.37
    (agent.split_reasoning_from_text), written out again here so the gate does not take the
    harness's word for it. A "close" split is marked by the model; an "open" split assumes
    the thought ran to the end of the reply (v2.5.38 counts those apart)."""
    if not text:
        return None, None, None
    end, mk = -1, None
    for m in _THINK_CLOSE:
        i = text.rfind(m)
        if i >= 0 and i + len(m) > end:
            end, mk = i + len(m), m
    if mk is not None:
        head, kind = text[:end - len(mk)], "close"
    else:
        found = [(text.find(m), m) for m in _THINK_OPEN if m in text]
        if not found:
            return None, None, None
        start, mk = min(found)
        head, kind = text[start:], "open"
    head = _GEMMA_CHANNEL_OPEN.sub("", head)
    for m in _THINK_OPEN + _THINK_CLOSE:
        head = head.replace(m, "")
    return head.strip(), kind, mk


def recovered_reasoning(text):
    """The reasoning a reply's text carries, or None (see reasoning_split)."""
    return reasoning_split(text)[0]

# ---- tool calls written as text (plan v2.5.5, §9 item 2 and §10) -------------------------
# A model sometimes writes a tool call as TEXT instead of making it, and the server files that
# text as reasoning or as content. Gemma-4-26B-A4B's OFF arm put a `finish` call's arguments
# in its reasoning field (1,288 chars) and made the call properly one step later; the
# Qwen3.6-35B-A3B twin's UNSEEN arm left a call's closing tags in its reasoning three times.
# Neither is thinking, and neither may be taken for it: G2 exists to catch a model thinking
# with thinking switched off, not a call in the wrong field. So a field that IS a call is set
# aside from every reasoning measure, and every step that lost a call this way is counted.
#
# The harness's tools, stated here from harness/tools.py (parameter names, then the required
# ones) rather than imported from it -- the same independence EXPECTED_BODY keeps. A tool
# added to the harness and not here is simply never recognised, which errs toward counting a
# field as reasoning, never away from it.
TOOL_PARAMS = {
    "read_file": (["path"], ["path"]),
    "write_file": (["path", "content"], ["path", "content"]),
    "edit_file": (["path", "old_str", "new_str"], ["path", "old_str", "new_str"]),
    "list_dir": (["path"], []),
    "run_command": (["command"], ["command"]),
    "run_background_command": (["command"], ["command"]),
    "run_command_and_capture_output": (["command", "duration"], ["command", "duration"]),
    "list_background_commands": ([], []),
    "stop_background_command": (["pid"], ["pid"]),
    "check_boot": ([], []),
    "start_app": ([], []),
    "run_tests": ([], []),
    "run_typecheck": ([], []),
    "run_lint": ([], []),
    "start_server": (["port"], []),
    "screenshot": (["url"], ["url"]),
    "browser_navigate": (["url"], ["url"]),
    "browser_click": (["selector"], ["selector"]),
    "browser_type": (["selector", "text", "press_enter"], ["selector", "text"]),
    "browser_drag": (["source", "target"], ["source", "target"]),
    "browser_read": (["selector"], []),
    "browser_wait": (["ms", "selector"], []),
    "browser_new_page": (["url"], []),
    "browser_switch_page": (["page"], ["page"]),
    "browser_close_page": (["page"], []),
    "browser_screenshot": ([], []),
    "finish": (["summary"], []),
}
# Tool-call markup as the roster's templates spell it (plan §4.2.2): the Qwen / Granite /
# Nemotron / Seed XML, GLM's arg_key / arg_value, Seed's seed:tool_call, Magistral's
# [TOOL_CALLS] / [ARGS], Gemma 4's <|tool_call> ... <tool_call|>, gpt-oss's harmony, and
# (plan v2.5.19) Muse Glimmer's ATEM, <atem:function_calls> ... </atem:function_calls>.
CALL_MARKERS = ("<tool_call>", "</tool_call>", "<function=", "</function>", "<parameter=",
                "</parameter>", "<seed:tool_call>", "</seed:tool_call>", "<arg_key>",
                "</arg_key>", "<arg_value>", "</arg_value>", "[TOOL_CALLS]", "[ARGS]",
                "<|tool_call>", "<tool_call|>", "<|call|>", "to=functions.",
                "<atem:function_calls>", "</atem:function_calls>", "<atem:invoke",
                "</atem:invoke>", "<atem:parameter", "</atem:parameter>")
CALL_OPENERS = ("<tool_call>", "<seed:tool_call>", "<|tool_call>", "[TOOL_CALLS]",
                "<atem:function_calls>")
CALL_CLOSERS = ("</tool_call>", "</seed:tool_call>", "<tool_call|>", "<|call|>",
                "</atem:function_calls>")
_FENCE_RE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\n?(.*?)\n?```$", re.S)


def json_call(text):
    """The tool whose arguments this field IS, else None: one JSON object whose keys are one
    tool's parameters, every required one included -- optionally in a code fence, optionally
    wrapped as {"name": <tool>, "arguments": {...}}, optionally followed by the tool's name
    (Gemma-4-26B-A4B wrote `{"summary": ...}` and then `finish`). Anything else, including a
    payload with prose around it, is not a call."""
    s = (text or "").strip()
    m = _FENCE_RE.match(s)
    if m:
        s = m.group(1).strip()
    if not s.startswith("{"):
        return None
    try:
        obj, end = json.JSONDecoder().raw_decode(s)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    rest = s[end:].strip()
    hint = None
    if rest:
        if rest not in TOOL_PARAMS:
            return None
        hint = rest
    args = obj
    name = obj.get("name")
    if isinstance(name, str) and name in TOOL_PARAMS:
        for k in ("arguments", "parameters", "args"):
            if isinstance(obj.get(k), dict):
                args, hint = obj[k], name
                break
    keys = set(args)
    if not keys:
        return None
    for tool, (params, required) in TOOL_PARAMS.items():
        if hint and tool != hint:
            continue
        if keys <= set(params) and set(required) <= keys:
            return tool
    return None


def field_is_call(text):
    """True when the whole field is a tool call: a payload json_call() recognises, a complete
    marked-up call (opens with a call opener, ends with a call closer), or nothing but
    call-markup tags (the Qwen twin's bare `</parameter></function></tool_call>`)."""
    s = (text or "").strip()
    if not s:
        return False
    if json_call(s):
        return True
    if s.startswith(CALL_OPENERS) and (s.endswith(CALL_CLOSERS) or s.startswith("[TOOL_CALLS]")):
        return True
    residue = s
    for mk in CALL_MARKERS:
        residue = residue.replace(mk, "")
    return not residue.strip()


def call_as_text(text):
    """'payload' or 'markup' when a field holds a tool call written as text, else None."""
    if json_call(text):
        return "payload"
    if any(mk in (text or "") for mk in CALL_MARKERS):
        return "markup"
    return None


# Bounded globs, NOT "**". A run directory contains the app the agent built, which for
# these tasks means a node_modules tree of ~40k files; a recursive glob walks every one of
# them and takes minutes on a network mount to find files it could have addressed directly.
# The layouts differ only in how many levels sit above `runs`, so enumerate those instead:
#   classic  <model>/<task>/<condition>/runs/<id>/
#   blind    <model>/<task>/runs/<id>/
#   probe    <task>/<condition>/runs/<id>/
TRACE_GLOBS = [("*/" * n) + "runs/*/smoke/logs/trace.jsonl" + z
               for z in ("", ZST) for n in range(0, 5)]


def find_traces(root: Path):
    """One trace per run: trace.jsonl, or trace.jsonl.zst when only that is there. Both
    are returned under the plain name; open_log() finds whichever exists."""
    seen = {}
    for pattern in TRACE_GLOBS:
        for trace in root.glob(pattern):
            if trace.suffix == ZST:
                trace = trace.with_suffix("")
            seen[str(trace)] = trace
    return [seen[k] for k in sorted(seen)]


def load_runs(root: Path):
    runs = []
    for trace in find_traces(root):
        run_dir = trace.parent.parent.parent
        rid = run_dir.name
        arm = ARM_OF.get(rid[:1], "?")
        man_path = run_dir / "smoke" / "logs" / "manifest.json"
        try:
            man = json.loads(man_path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            man = {}
        steps, lengths, empty, no_tool, reasoned, leaks, recov = 0, [], 0, 0, 0, [], 0
        recov_open = []                  # splits at an opening tag: (step, chars, tag)
        off_lengths = []                 # G2's measure: budget reports not counted (v2.5.37)
        call_fields, call_txt = [], []   # reasoning fields set aside; steps that lost a call
        calls = []                       # every call, numbers masked (plan v2.5.14, G9)
        with open_log(trace) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("kind") != "response":
                    continue
                raw = row.get("raw") or {}
                # plan v2.5.37: `text` is the reply as the harness KEPT it -- the trace row's
                # own `text`, which is what was replayed -- and the reasoning includes any the
                # server left in its reply text (recomputed here, see recovered_reasoning()).
                text = row.get("text") if "text" in row else raw.get("content")
                text = text or ""
                rsn = raw.get("reasoning_content") or ""
                rec, rec_kind, rec_tag = reasoning_split(raw.get("content") or "")
                if rec is not None:
                    recov += 1
                    if rec_kind == "open":
                        recov_open.append((row.get("step"), len(rec), rec_tag))
                    if rec:
                        rsn = (rsn.rstrip() + "\n\n" + rec) if rsn.strip() else rec
                steps += 1
                # A reasoning field that IS a tool call is a call in the wrong field, not
                # thinking (plan v2.5.5): it counts as no reasoning in every measure below,
                # and it is listed so G2 can say what it set aside.
                if field_is_call(rsn):
                    call_fields.append((row.get("step", steps), len(rsn),
                                        json_call(rsn) or "markup"))
                    lengths.append(0)
                    off_lengths.append(0)
                else:
                    lengths.append(len(rsn))
                    off_lengths.append(len(_BUDGET_REPORT.sub("", rsn).strip()))
                    if rsn.strip():
                        reasoned += 1
                for c in row.get("tool_calls") or []:
                    try:
                        fp = json.dumps([c.get("name"), c.get("arguments")], sort_keys=True)
                    except (TypeError, ValueError, AttributeError):
                        fp = repr(c)
                    calls.append(_NUM.sub("#", fp))
                if not (row.get("tool_calls") or []):
                    # A turn with no call whose reasoning or content holds one written as
                    # text: the call was made in the wrong place, or lost on the way in.
                    kind = call_as_text(rsn) or call_as_text(text)
                    if kind:
                        call_txt.append((row.get("step", steps),
                                         "reasoning" if call_as_text(rsn) else "content", kind))
                    # The harness nudges on a turn with no tool call and ends the run when
                    # the reply to a nudge has none either (plan v2.5.14; until then the
                    # second such turn anywhere in the run ended it), so these turns are
                    # what a run ends on when it ends in silence. An "empty" turn (no text
                    # either) is the subset where the model said nothing at all; a turn
                    # with prose and no call is the other failure mode, where the model
                    # narrates code instead of writing it.
                    no_tool += 1
                    if not text.strip():
                        empty += 1
                for marker in LEAK_MARKERS:
                    if marker in text:
                        leaks.append((row.get("step"), marker))
        # Everything above `runs/<id>` is the layout's context, and how much of it there
        # is tells you which layout this run was made in.
        ctx = run_dir.relative_to(root).parts[:-2]
        model, task, condition = "-", "-", "-"
        if len(ctx) >= 3:
            model, task, condition = ctx[-3], ctx[-2], ctx[-1]
        elif len(ctx) == 2:
            task, condition = ctx            # probe layout: no model level
        elif len(ctx) == 1:
            task = ctx[0]
        runs.append({
            "model": model, "task": task, "condition": condition, "id": rid, "arm": arm,
            "path": run_dir, "man": man, "steps": steps, "empty": empty, "no_tool": no_tool,
            "reasoned": reasoned, "lengths": lengths or [0], "leaks": leaks, "recov": recov, "recov_open": recov_open,
            "off_lengths": off_lengths or [0],
            "call_fields": call_fields, "call_txt": call_txt,
            "rate": reasoned / steps if steps else 0.0,
            "tail_calls": calls[-LOOP_TAIL:],
            # plan v2.5.34: how many of the last LOOP_TAIL calls (numbers masked) repeat a
            # call the run had already made before that point -- the no-progress test.
            "tail_repeats": sum(1 for i in range(max(0, len(calls) - LOOP_TAIL), len(calls))
                                if calls[i] in set(calls[:i])),
        })
    return runs


# ---- every attempt, the failed ones included (plan v2.5.9) --------------------------------
# The batch driver re-runs a failed slot up to three times. In the classic smoke layout every
# attempt writes the same run directory, so until v2.5.9 each retry overwrote the failure
# before it, and with it the server log recording what the model wrote. The driver now MOVES
# a failed attempt to <condition>/failed-attempts/<id>.attempt<N> first -- outside runs/, so
# no gate above ever sees it -- and this finds them. (A blind grid run draws a new id per
# attempt, so its failed attempts are ordinary runs already.) Counted per model x arm and by
# cause, because a failure rate that differs between arms is the treatment eating its own
# evidence (plan §10) -- and over ATTEMPTS, not slots, because a slot that fails and then
# succeeds on a re-run has still failed once.
ATTEMPT_GLOBS = [("*/" * n) + "failed-attempts/*" for n in range(0, 5)]
_UNPARSED_LOG_RE = re.compile(r"unparsed peg-native output:\s?(.*)")


def server_log_unparsed(run_dir: Path):
    """What the model wrote when its server could not parse it: the last 'unparsed
    peg-native output' line in the run's llama-server.log, or None."""
    last = None
    try:
        with open_log(run_dir / "smoke" / "logs" / "llama-server.log") as fh:
            for line in fh:
                m = _UNPARSED_LOG_RE.search(line)
                if m:
                    last = m.group(1).strip()
    except OSError:
        return None
    return last


def trace_fingerprint(run_dir: Path):
    """A hash of every response the run received -- content, reasoning and tool calls, in
    order -- so two attempts of one slot can be found identical (plan v2.5.11); None when the
    run left no response at all."""
    h, n = hashlib.sha256(), 0
    try:
        with open_log(run_dir / "smoke" / "logs" / "trace.jsonl") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("kind") != "response":
                    continue
                raw = row.get("raw") or {}
                h.update(json.dumps([raw.get("content") or "", raw.get("reasoning_content") or "",
                                     row.get("tool_calls") or []], sort_keys=True).encode())
                n += 1
    except OSError:
        return None
    return h.hexdigest()[:16] if n else None


def attempt_cause(man, run_dir: Path):
    """(cause, detail) for a failed attempt: 'unparseable', 'server crash' or 'other'."""
    ae = (man or {}).get("api_error") or {}
    body = " ".join(str(ae.get("body") or "").split())
    unparsed = server_log_unparsed(run_dir)
    if parse_void(man) or (not man and unparsed):
        return "unparseable", unparsed or body
    if ae.get("server_model_crash"):
        return "server crash", body
    if not man:
        return "other", "no manifest -- the attempt died before the agent wrote one"
    return "other", f"status={man.get('status')!r} {body}".strip()


def load_failed_attempts(root: Path):
    found = {}
    for pattern in ATTEMPT_GLOBS:
        for d in root.glob(pattern):
            if d.is_dir():
                found[str(d)] = d
    out = []
    for key in sorted(found):
        d = found[key]
        rid, _, n = d.name.partition(".attempt")
        try:
            man = json.loads((d / "smoke" / "logs" / "manifest.json").read_text(
                encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            man = {}
        ctx = d.relative_to(root).parts[:-2]       # what sits above failed-attempts/<id>
        model, task, condition = "-", "-", "-"
        if len(ctx) >= 3:
            model, task, condition = ctx[-3], ctx[-2], ctx[-1]
        elif len(ctx) == 2:
            task, condition = ctx
        elif len(ctx) == 1:
            task = ctx[0]
        cause, detail = attempt_cause(man, d)
        out.append({"model": model, "task": task, "condition": condition, "id": rid,
                    "arm": ARM_OF.get(rid[:1], "?"), "attempt": n.split(".")[0] or "?",
                    "cause": cause, "detail": detail, "fp": trace_fingerprint(d)})
    return out


class Gates:
    def __init__(self):
        self.results = []

    def gate(self, name, failures, detail="", waived=()):
        self.results.append((name, list(failures), detail, list(waived)))

    def report(self):
        failed = self.waived = 0
        for name, failures, detail, waived in self.results:
            if failures:
                failed += 1
                print(f"\nFAIL  {name}")
                if detail:
                    print(f"      {detail}")
                for f in failures:
                    print(f"      - {f}")
                for w in waived:
                    print(f"      - waived: {w}")
            elif waived:
                # plan v2.5.14: passed only because the study lead waived what it found.
                self.waived += 1
                print(f"\nWAIVE {name}")
                if detail:
                    print(f"      {detail}")
                for w in waived:
                    print(f"      - {w}")
            else:
                print(f"pass  {name}" + (f"   ({detail})" if detail else ""))
        return failed


def tag(r):
    return f"{r['model']}/{r['task']}/{r['condition']}/{r['id']} [{r['arm']}]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--decoding-registry", default=None,
                    help="path to decoding-registry.json (default: beside the harness)")
    ap.add_argument("--budget", type=int, default=BUDGET,
                    help="the token budget these runs were MADE with (default: the study's "
                         f"{BUDGET:,}). Pass the older value to verify a set made before a "
                         "budget change -- a gate that always fails is a gate people learn "
                         "to ignore, and the smoke set predating the 8M freeze is the case "
                         "this exists for.")
    ap.add_argument("--no-retry-record", action="store_true",
                    help="verify a set made before retries were recorded (plan v2.5.8) "
                         "without failing G16 for the missing api_retries field; a "
                         "recorded timeout retry still fails it.")
    args = ap.parse_args()
    budget = args.budget
    root = Path(args.root)
    runs = load_runs(root)
    if not runs:
        print(f"no runs found under {root}")
        return 1
    print(f"{len(runs)} runs under {root}\n")

    if args.verbose:
        hdr = f"{'run':52}{'steps':>6}{'empty':>6}{'rsn%':>6}{'rsn max':>9}{'replay':>8}{'preamble':>12}"
        print(hdr + "\n" + "-" * len(hdr))
        for r in sorted(runs, key=lambda x: (x["model"], x["arm"], x["condition"])):
            print(f"{tag(r):52}{r['steps']:6}{r['empty']:6}{100*r['rate']:5.0f}%"
                  f"{max(r['lengths']):9}{str(r['man'].get('reasoning_replayed')):>8}"
                  f"{str(r['man'].get('think_preamble_key','-')):>12}")
        print()

    g = Gates()

    # G1 arm <-> replay
    want = {"SEEN": True, "UNSEEN": False, "OFF": False}
    g.gate("G1  arm ↔ reasoning_replayed",
           [f"{tag(r)}: recorded {r['man'].get('reasoning_replayed')!r}, arm wants {want[r['arm']]}"
            for r in runs if r["arm"] in want and r["man"].get("reasoning_replayed") is not want[r["arm"]]])

    # G2 OFF canary
    offs = [r for r in runs if r["arm"] == "OFF"]
    set_aside = [f"{tag(r)} step {s}: {n} chars were a `{what}` call, not reasoning"
                 for r in offs for s, n, what in r["call_fields"] if n > OFF_MAX]
    long_offs = [r for r in offs if max(r["off_lengths"]) > OFF_MAX]
    g.gate(f"G2  OFF canary: no reasoning step > {OFF_MAX} chars",
           [f"{tag(r)}: longest reasoning {max(r['off_lengths'])} chars" for r in long_offs
            if r["model"] not in G2_WAIVED],
           f"{len(offs)} OFF runs; longest stub seen {max((max(r['off_lengths']) for r in offs), default=0)} chars"
           " (Seed-OSS budget reports not counted)"
           + (f"; set aside as tool calls filed in the reasoning field (v2.5.5): "
              + "; ".join(set_aside) if set_aside else ""),
           waived=[f"{tag(r)}: longest reasoning {max(r['off_lengths'])} chars -- "
                   f"{G2_WAIVED[r['model']]}" for r in long_offs if r["model"] in G2_WAIVED])

    # G3 ON canary
    ons = [r for r in runs if r["arm"] in ("UNSEEN", "SEEN")]
    on_fail = []
    for r in ons:
        if max(r["lengths"]) <= OFF_MAX:
            on_fail.append(f"{tag(r)}: longest reasoning only {max(r['lengths'])} chars — this arm is not thinking")
        elif r["rate"] < ON_MIN_RATE:
            on_fail.append(f"{tag(r)}: reasoned on {100*r['rate']:.0f}% of {r['steps']} steps (floor {100*ON_MIN_RATE:.0f}%)")
    g.gate(f"G3  ON canary: a step > {OFF_MAX} chars and ≥ {100*ON_MIN_RATE:.0f}% of steps reasoning",
           on_fail, f"{len(ons)} thinking-arm runs")

    # G4 leakage
    g.gate("G4  no think, channel or turn marker in the reply text as kept",
           [f"{tag(r)}: {mark} in the reply text at step {step}"
            for r in runs for step, mark in r["leaks"]],
           f"{sum(r['recov'] for r in runs)} step(s) had reasoning in the reply text "
           f"({sum(r['recov'] - len(r['recov_open']) for r in runs)} split at a closing tag, "
           f"{sum(len(r['recov_open']) for r in runs)} at an opening tag only), "
           f"moved to the reasoning field (plan v2.5.37)")

    # G5 preamble
    pre_fail = []
    by_model = defaultdict(list)
    for r in runs:
        by_model[r["model"]].append(r)
    for model, rs in by_model.items():
        for r in rs:
            if r["arm"] == "OFF" and r["man"].get("think_preamble_key", "none") != "none":
                pre_fail.append(f"{tag(r)}: OFF arm carries preamble {r['man'].get('think_preamble_key')!r}")
        keys = {r["man"].get("think_preamble_key", "none") for r in rs if r["arm"] in ("UNSEEN", "SEEN")}
        if len(keys) > 1:
            pre_fail.append(f"{model}: thinking arms disagree on preamble: {sorted(keys)}")
    g.gate("G5  preamble: none in OFF, identical across thinking arms", pre_fail)

    # G6 frozen inputs
    frozen_fail = []
    for field in ("base_prompt_sha", "condition_briefing_sha", "harness_git"):
        vals = {r["man"].get(field) for r in runs}
        if len(vals) > 1:
            frozen_fail.append(f"{field} differs across the set: {sorted(map(str, vals))}")
    by_task = defaultdict(set)
    for r in runs:
        by_task[r["task"]].add(r["man"].get("task_sha"))
    for task, vals in by_task.items():
        if len(vals) > 1:
            frozen_fail.append(f"task_sha differs within {task}: {sorted(map(str, vals))}")
    g.gate("G6  frozen inputs identical across the set", frozen_fail,
           f"harness_git={next(iter({str(r['man'].get('harness_git')) for r in runs}))}")

    # G7 provenance
    g.gate("G7  quantization resolved from the registry",
           [f"{tag(r)}: status={(r['man'].get('quantization_detail') or {}).get('status')}"
            for r in runs if (r["man"].get("quantization_detail") or {}).get("status") != "ok"])

    # G8 body identical across thinking arms
    body_fail = []
    for model, rs in by_model.items():
        bodies = {json.dumps(r["man"].get("extra_body"), sort_keys=True)
                  for r in rs if r["arm"] in ("UNSEEN", "SEEN")}
        if len(bodies) > 1:
            body_fail.append(f"{model}: thinking arms sent different bodies: {sorted(bodies)}")
    g.gate("G8  request body identical across thinking arms", body_fail)

    # G9 budget
    def total(r):
        u = r["man"].get("total_tokens_used") or {}
        return u.get("total_tokens") or 0
    peaks = sorted(((total(r), r) for r in runs), reverse=True, key=lambda x: x[0])
    over, near, looped = [], [], []
    for t, r in peaks:
        if t <= budget * HEADROOM:
            continue
        # plan v2.5.14: a run that reached the budget while looping is an outcome, not a
        # run the budget cut short -- the waiver the study lead took on the GLM-4.7-Flash
        # run that posted "Test card in done 2" up to 184 on identical reasoning.
        tail = r.get("tail_calls") or []
        distinct = len(set(tail))
        repeats = r.get("tail_repeats", 0)
        at_budget = (r["man"].get("status") == "token_budget_exhausted"
                     and len(tail) >= LOOP_TAIL)
        if at_budget and distinct <= LOOP_DISTINCT:
            looped.append(f"{tag(r)}: {t:,} tokens, reached while looping -- its last "
                          f"{LOOP_TAIL} calls are {distinct} distinct once numbers are masked "
                          f"(plan v2.5.14: an outcome, not a censored run)")
        elif at_budget and repeats >= LOOP_TAIL:
            # plan v2.5.34: the harness's no-progress definition, numbers masked -- a loop
            # whose calls differ only in a pid or a timestamp (2026-10-04, Gemma-4-26B-A4B).
            looped.append(f"{tag(r)}: {t:,} tokens, reached while looping -- each of its "
                          f"last {LOOP_TAIL} calls repeats one it had already made, once "
                          f"numbers are masked ({distinct} distinct; plan v2.5.34: an "
                          f"outcome, not a censored run)")
        elif at_budget and f"{r['model']}/{r['task']}/{r['condition']}/{r['id']}" in G9_JUDGED:
            j = G9_JUDGED[f"{r['model']}/{r['task']}/{r['condition']}/{r['id']}"]
            fp = trace_fingerprint(r["path"])
            if fp == j["fingerprint"]:
                looped.append(f"{tag(r)}: {t:,} tokens, JUDGED stuck -- {j['judged']} "
                              f"(trace {fp})")
            else:
                over.append(f"{tag(r)}: {t:,} tokens -- a judged waiver is recorded for this "
                            f"slot's trajectory {j['fingerprint']}, but this run's is {fp}: "
                            f"judge it again")
        elif t > budget:
            over.append(f"{tag(r)}: {t:,} tokens")
        else:
            near.append(f"{tag(r)}: {t:,} tokens ({100*t/budget:.0f}% of budget)")
    g.gate(f"G9  token budget {budget:,}", over + near,
           f"peak {peaks[0][0]:,} ({100*peaks[0][0]/budget:.0f}% of budget) in {tag(peaks[0][1])}"
           if peaks and peaks[0][0] else "no usage recorded in manifests",
           waived=looped)

    # G11 — the body is the treatment, so pin it exactly rather than only checking the two
    # thinking arms agree with each other (G8). A model's arms could agree perfectly and
    # still all be wrong.
    body_fail = []
    for r in runs:
        want = (EXPECTED_BODY.get(r["model"]) or {}).get(r["arm"])
        if want is None:
            body_fail.append(f"{tag(r)}: no expected body registered for this model/arm")
            continue
        got = r["man"].get("extra_body")
        if got != want:
            body_fail.append(f"{tag(r)}: sent {json.dumps(got, sort_keys=True)}, "
                             f"expected {json.dumps(want, sort_keys=True)}")
    g.gate("G11 request body matches the frozen per-model, per-arm spec", body_fail,
           f"{len(runs)} runs checked against EXPECTED_BODY")

    # G12 — the route the reasoning travels is as much a treatment as whether it travels.
    fmt_fail = []
    for r in runs:
        want = EXPECTED_REPLAY_FORMAT.get(r["model"])
        got = r["man"].get("replay_format")
        if want is None:
            fmt_fail.append(f"{tag(r)}: no expected replay_format registered for this model")
        elif got != want:
            fmt_fail.append(f"{tag(r)}: replay_format={got!r}, expected {want!r}")
    g.gate("G12 replay_format matches the frozen per-model spec", fmt_fail,
           f"{len(runs)} runs checked against EXPECTED_REPLAY_FORMAT")

    # G13 — which preamble, not merely that the two thinking arms agree on one (G5).
    pre_fail = []
    for r in runs:
        want = EXPECTED_PREAMBLE.get(r["model"])
        got = r["man"].get("think_preamble_key")
        if want is None:
            pre_fail.append(f"{tag(r)}: no expected preamble registered for this model")
        elif r["arm"] == "OFF":
            if got != "none":
                pre_fail.append(f"{tag(r)}: OFF arm carries preamble {got!r}")
        elif got != want:
            pre_fail.append(f"{tag(r)}: think_preamble_key={got!r}, expected {want!r}")
    g.gate("G13 thinking preamble matches the frozen per-model spec", pre_fail,
           f"{len(runs)} runs checked against EXPECTED_PREAMBLE")

    budgets = {}
    for r in runs:
        budgets.setdefault(r["man"].get("max_total_tokens"), []).append(tag(r))
    g.gate(f"G10 runs were made with max_total_tokens = {budget:,}",
           [f"{len(v)} run(s) recorded max_total_tokens={k!r}, e.g. {v[0]}"
            for k, v in budgets.items() if k != budget],
           f"recorded values: {sorted(str(k) for k in budgets)}")

    # G14 — voids caused by the model's own unparseable output.
    voids = [r for r in runs if parse_void(r["man"])]
    unexplained = [r for r in runs if unexplained_api_error(r["man"])]
    cells = defaultdict(lambda: [0, 0])
    for r in runs:
        c = cells[(r["model"], r["arm"])]
        c[0] += 1
        if parse_void(r["man"]):
            c[1] += 1
    over = [f"{m}/{a}: {v} of {n} runs voided by unparseable model output "
            f"({100*v/max(n,1):.0f}% > {100*VOID_CEILING_NUM/VOID_CEILING_DEN:.0f}% ceiling)"
            for (m, a), (n, v) in sorted(cells.items())
            if v * VOID_CEILING_DEN > n * VOID_CEILING_NUM]
    over_waived = [x for x in over if x.split("/", 1)[0] in G14_WAIVED]
    over = [x for x in over if x.split("/", 1)[0] not in G14_WAIVED]
    g.gate("G14 unparseable-output voids attributed and under the ceiling",
           [f"{tag(r)}: api_error with no attributable cause — "
            f"{str((r['man'].get('api_error') or {}).get('body'))[:110]}"
            for r in unexplained] + over,
           f"{len(voids)} void(s) across {len(runs)} runs"
           + (f"; per arm: " + ", ".join(f"{m}/{a}={v}"
              for (m, a), (n, v) in sorted(cells.items()) if v) if voids else ""),
           waived=[f"{x} -- {G14_WAIVED[x.split('/', 1)[0]]}" for x in over_waived])

    # G15 — decoding matches the registered per-model, per-mode profile.
    reg, reg_path = load_decoding_registry(args.decoding_registry)
    dec_fail = []
    if reg is None:
        dec_fail.append(f"decoding registry not found (looked for {DECODING_REGISTRY}) — "
                        f"cannot check any run's sampling")
    else:
        for r in runs:
            man, d = r["man"], (r["man"].get("decoding") or {})
            src = man.get("decoding_source")
            if src != "registry":
                dec_fail.append(f"{tag(r)}: decoding_source={src!r} — this run was not "
                                f"configured from the registry (pre-v2.4.0 runs and "
                                f"hand-run agents both look like this)")
                continue
            alias = man.get("model")
            prof = (reg.get(alias) or {}).get(ARM_MODE.get(r["arm"], "thinking"))
            if not prof:
                dec_fail.append(f"{tag(r)}: no {ARM_MODE.get(r['arm'])!r} profile for "
                                f"model {alias!r} in the registry")
                continue
            for k in SAMPLERS:
                if k in prof and d.get(k) != prof[k]:
                    dec_fail.append(f"{tag(r)}: {k}={d.get(k)!r}, registry says "
                                    f"{prof[k]!r}")
    # The thinking arms must be sampled identically — the primary contrast varies what the
    # model can see and nothing else. (OFF may legitimately differ; only Qwen does.)
    per_model = defaultdict(dict)
    for r in runs:
        if r["arm"] in ("UNSEEN", "SEEN"):
            per_model[r["model"]][r["arm"]] = {k: (r["man"].get("decoding") or {}).get(k)
                                               for k in SAMPLERS}
    for m, arms in sorted(per_model.items()):
        if len(arms) == 2 and arms["UNSEEN"] != arms["SEEN"]:
            dec_fail.append(f"{m}: UNSEEN and SEEN are sampled differently "
                            f"({arms['UNSEEN']} vs {arms['SEEN']}) — the primary contrast "
                            f"must vary only what the model can see")
    shas = {str((r["man"] or {}).get("decoding_registry_sha")) for r in runs}
    if len(shas) > 1:
        dec_fail.append(f"the set was made against {len(shas)} different decoding "
                        f"registries: {sorted(shas)}")
    g.gate("G15 decoding matches the registered per-model, per-mode profile", dec_fail,
           f"registry {reg_path}; sha(s) recorded: {sorted(shas)}" if reg else "")

    # G16 -- retried model calls (plan v2.5.8). A retry re-rolls a generation from zero and
    # only the last attempt reaches the trace. A TIMEOUT retry falls on exactly the longest
    # replies -- a runaway timed out and re-rolled into a short reply reads as a clean run --
    # so any set that contains one fails. Connection drops, HTTP 5xx and a crashed server
    # reloading are random infrastructure events; they are listed for the record, not failed.
    ret_fail, ret_note, n_retries, unrecorded = [], [], 0, 0
    for r in runs:
        ar = r["man"].get("api_retries")
        if not isinstance(ar, dict):
            unrecorded += 1
            if not args.no_retry_record:
                ret_fail.append(f"{tag(r)}: no api_retries field -- made before retries were "
                                f"recorded (plan v2.5.8), so a timeout retry in it could not "
                                f"be seen")
            continue
        n_retries += int(ar.get("count") or 0)
        for ev in ar.get("events") or []:
            line = (f"{tag(r)}: call {ev.get('call')}, retry {ev.get('retry')} -- "
                    f"{ev.get('kind')} after {ev.get('failed_after_s')}s")
            (ret_fail if ev.get("kind") == "timeout" else ret_note).append(line)
    g.gate("G16 no timed-out model call was re-rolled (api_retries)", ret_fail,
           f"{n_retries} retried call(s) across {len(runs)} runs"
           + (f"; {unrecorded} run(s) predate the record (--no-retry-record)"
              if unrecorded and args.no_retry_record else "")
           + ("; listed, not failed: " + "; ".join(ret_note) if ret_note else ""))

    # G17 -- per-model serving flags (plan v2.5.24), read from the banner each run's log
    # carries, since the manifest does not record the server's command line.
    flag_fail, n_checked = [], 0
    for r in runs:
        got_args = banner_args(r["path"])
        if got_args is None:
            flag_fail.append(f"{tag(r)}: no args line in llama-server.log")
            continue
        n_checked += 1
        want = FROZEN_SERVER_ARGS + list(EXPECTED_SERVER_FLAGS.get(r["model"], []))
        got = frozen_part(got_args)
        if got != want:
            missing = [a for a in want if a not in got]
            extra = [a for a in got if a not in want]
            flag_fail.append(f"{tag(r)}: serving args differ from the frozen spec"
                             + (f"; missing {missing}" if missing else "")
                             + (f"; not in the spec {extra}" if extra else "")
                             + ("" if missing or extra else f"; order or values differ: {' '.join(got)}"))
    g.gate("G17 serving flags match the frozen spec exactly", flag_fail,
           f"{n_checked} runs checked against {' '.join(FROZEN_SERVER_ARGS)}"
           + (f", plus {EXPECTED_SERVER_FLAGS}" if EXPECTED_SERVER_FLAGS else ""))

    # G18 -- context overflow is an outcome (plan v2.5.28).
    ov_fail = [f"{tag(r)}: an overflow filed as api_error -- the batch driver would re-run it"
               for r in runs if overflow_filed_as_error(r["man"])]
    for a in load_failed_attempts(root):
        if _OVERFLOW_RE.search(str(a.get("detail") or "")):
            ov_fail.append(f"{a['model']}/{a['task']}/{a['condition']}/{a['id']} [{a['arm']}] "
                           f"attempt {a['attempt']}: an overflow filed as api_error and re-run")
    ov_cells = Counter((r["model"], r["arm"]) for r in runs
                       if (r["man"].get("status") or r["man"].get("terminal_status"))
                       == "context_overflow")
    g.gate("G18 a context overflow is kept as an outcome, never re-run", ov_fail,
           f"{sum(ov_cells.values())} context_overflow run(s)"
           + (": " + ", ".join(f"{m}/{a}={n}" for (m, a), n in sorted(ov_cells.items()))
              if ov_cells else ""))

    failed = g.report()

    # Descriptives the plan registers (§10) — reported, never gated.
    print("\n--- registered descriptives (not gates) ---")
    print(f"{'model':16}{'arm':8}{'runs':>5}{'steps':>7}{'noTool':>8}{'empty':>7}{'callTxt':>9}"
          f"{'recov':>7}{'atOpen':>8}{'rsn%':>7}{'parseVoid':>10}{'median rsn chars':>18}   terminal status")
    agg = defaultdict(lambda: [0, 0, 0, 0, [], [], 0, 0, 0, 0])
    for r in runs:
        a = agg[(r["model"], r["arm"])]
        a[0] += 1; a[1] += r["steps"]; a[2] += r["no_tool"]; a[3] += r["empty"]
        a[4] += r["lengths"]; a[5].append(r["man"].get("status", "?"))
        # Per-arm, because that is the only breakdown in which this number means anything:
        # a void rate that differs between UNSEEN and SEEN is the treatment eating its own
        # evidence, and a pooled total hides exactly that.
        a[6] += 1 if parse_void(r["man"]) else 0
        # Steps whose tool call was written as text in the reasoning or content field and
        # never made (plan §10, v2.5.5). A subset of noTool, reported per arm for the same
        # reason as parseVoid: if it differs between UNSEEN and SEEN it is part of the result.
        a[7] += len(r["call_txt"])
        # plan v2.5.37: steps whose reasoning was in the reply text (moved by the harness).
        a[8] += r["recov"]
        # v2.5.38: of those, the splits at an opening tag never closed -- the thought is
        # assumed to run to the end of the reply, so they are counted apart.
        a[9] += len(r["recov_open"])
    for k in sorted(agg):
        n, steps, no_tool, empty, lens, stats, nvoid, ncall, nrecov, nopen = agg[k]
        thinking = [x for x in lens if x]
        # Median over REASONING steps only. Over all steps it collapses to 0 the moment a
        # model reasons on fewer than half of them, which reads as "no reasoning" when the
        # truth is "reasoned hard, on a third of the turns" — the Qwen UNSEEN case exactly.
        med = int(statistics.median(thinking)) if thinking else 0
        tally = ", ".join(f"{c}x {st}" for st, c in
                          sorted(Counter(stats).items(), key=lambda kv: -kv[1]))
        print(f"{k[0]:16}{k[1]:8}{n:5}{steps:7}{no_tool:8}{empty:7}{ncall:9}{nrecov:7}{nopen:8}"
              f"{100*len(thinking)/max(steps,1):6.0f}%{nvoid:10}{med:18}   {tally}")

    # Every attempt, the failed ones included (plan v2.5.9) -- reported, never gated.
    # plan v2.5.11: and a REPLAY is told from a new failure. In the classic smoke layout every
    # attempt of a slot sends the same prompt -- its workspace path included -- with the same
    # per-replicate seed, and on this engine that has reproduced the same tokens: gpt-oss's
    # smoke of 2026-09-26 repeated its re-smoke of 2026-09-25 response for response, and each
    # of its retries repeated its first attempt. A replay is one failure seen again, so the
    # table counts DISTINCT failed trajectories beside the attempts.
    attempts = load_failed_attempts(root)
    slot_of = lambda x: (x["model"], x["task"], x["condition"], x["id"])
    kept_per_slot = Counter(slot_of(a) for a in attempts)
    voided = [r for r in runs
              if (r["man"].get("status") or r["man"].get("terminal_status")) == "api_error"]
    need = {slot_of(a) for a in attempts} | {slot_of(r) for r in voided}
    final_fp = {slot_of(r): trace_fingerprint(r["path"]) for r in runs if slot_of(r) in need}

    def _num(a):
        try:
            return int(str(a["attempt"]).split(".")[0])
        except ValueError:
            return 0
    # Every failed attempt of a slot in order: the kept ones by number, the voided last one
    # after them. An attempt is a REPLAY when it is identical to an EARLIER attempt.
    seq = defaultdict(list)                 # slot -> [(number, fingerprint, entry, is_last)]
    for a in attempts:
        seq[slot_of(a)].append((_num(a), a["fp"], a, False))
    for r in voided:
        s = slot_of(r)
        seq[s].append((max([x[0] for x in seq[s]], default=0) + 1, final_fp.get(s), r, True))
    tally = defaultdict(Counter)
    lines, unkept, replays = [], 0, 0
    for r in runs:
        tally[(r["model"], r["arm"])]["slots"] += 1
    for s in sorted(seq):
        seen, distinct = set(), set()
        for n, fp, e, last in sorted(seq[s], key=lambda x: x[0]):
            rep = fp is not None and fp in seen
            if fp is not None:
                seen.add(fp)
            distinct.add(fp or f"no-trace-{n}")
            replays += rep
            if last:
                cause, detail = attempt_cause(e["man"], e["path"])
                c = tally[(e["model"], e["arm"])]
                c["failed"] += 1; c["void"] += 1; c[cause] += 1
                if not kept_per_slot[s]:
                    unkept += 1
                lines.append(f"{tag(e)} " + (f"attempt {n} (last)" if kept_per_slot[s]
                                             else "last attempt") + f", VOID: {cause}"
                             + (", REPLAY" if rep else "") + f" -- {detail[:150]}")
            else:
                c = tally[(e["model"], e["arm"])]
                c["kept"] += 1; c["failed"] += 1; c[e["cause"]] += 1
                lines.append(f"{e['model']}/{e['task']}/{e['condition']}/{e['id']} [{e['arm']}] "
                             f"attempt {n}: {e['cause']}" + (", REPLAY" if rep else "")
                             + f" -- {e['detail'][:150]}")
        tally[(s[0], ARM_OF.get(s[3][:1], "?"))]["distinct"] += len(distinct)
    # v2.5.38: every split made at an opening tag that was never closed. Where such a thought
    # ended is inferred (the end of the reply), not marked, so each is listed to be checked.
    opens = [(r, st, n, tg) for r in runs for st, n, tg in r["recov_open"]]
    print("\n--- reasoning moved at an OPENING tag never closed (v2.5.38; not a gate) ---")
    if not opens:
        print("none: every split was made at a closing tag")
    for r, st, n, tg in opens:
        print(f"  {tag(r)} step {st}: {tg}, {n:,} chars moved, status {r['man'].get('status', '?')}")

    print("\n--- every attempt, failed ones included (plan v2.5.9, v2.5.11; not a gate) ---")
    if not any(c["failed"] for c in tally.values()):
        print("no failed attempt kept and no slot voided")
    else:
        print(f"{'model':16}{'arm':8}{'slots':>6}{'attempts':>9}{'failed':>7}{'distinct':>9}"
              f"{'unparse':>8}{'crash':>6}{'other':>6}{'void':>5}")
        for k in sorted(tally):
            c = tally[k]
            print(f"{k[0]:16}{k[1]:8}{c['slots']:6}{c['slots'] + c['kept']:9}{c['failed']:7}"
                  f"{c['distinct']:9}{c['unparseable']:8}{c['server crash']:6}{c['other']:6}"
                  f"{c['void']:5}")
        for line in lines:
            print("  " + line)
        if replays:
            print(f"  {replays} attempt(s) are REPLAYS -- byte-identical, response for response, "
                  f"to an earlier attempt of the same slot: the same prompt and the same "
                  f"per-replicate seed gave the same tokens. Each is one failure seen again; "
                  f"'distinct' counts the failures.")
        if unkept:
            # plan v2.5.12: or run by hand, with no retries at all -- the gpt-oss probe was.
            print(f"  {unkept} voided slot(s) kept no earlier attempt: either they were run by "
                  f"hand, with no retries, or they were made before plan v2.5.9, when each "
                  f"retry overwrote the one before -- in which case their attempts column "
                  f"undercounts, and the batch-state progress file records how many attempts "
                  f"each slot took.")

    # plan v2.5.14: a gate that passed only by a waiver is said so, every time.
    wv = getattr(g, "waived", 0)
    wtail = f"; {wv} passed only by a registered waiver (WAIVE above)" if wv else ""
    print(f"\n{failed} gate(s) failed{wtail}" if failed else f"\nall gates passed{wtail}")
    return failed


if __name__ == "__main__":
    sys.exit(main())
