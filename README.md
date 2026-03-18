# Multi_LLM_Coding_Pipeline

A local, contract-driven workflow for running larger projects through multiple specialized LLM roles instead of one all-in-one prompt.

This project combines:

- six role prompts,
- a browser-based Operator Console,
- an End User Operating Guide,
- and an Operator Run Layer for execution support.

The goal is to make complex LLM-assisted work more structured, reviewable, and easier to recover when something goes wrong.

---

## What it does

The system breaks work into six roles:

1. **Requirements Engineer**
2. **Technical Architect**
3. **Project Orchestrator**
4. **Module Implementer**
5. **Code Reviewer**
6. **Merge Coordinator**

Instead of letting one model handle everything, each stage produces a formal artifact that becomes the input contract for the next stage.

Basic flow:

```text
Requirements -> Architecture -> Orchestration -> Implement -> Review -> Merge
```

For multi-package work, implementation and review repeat package by package before final merge.

---

## Included files

### Role prompts

- `01_Requirements_Engineer_v5.txt`
- `02_Technical_Architect_v5.txt`
- `03_Project_Orchestrator_v5.txt`
- `04_Module_Implementer_v5.txt`
- `05_Code_Reviewer_v5.txt`
- `06_Merge_Coordinator_v5.txt`

### Guides

- `07_End_User_Operating_Guide_v5.txt`
- `08_Operator_Run_Layer_v5.txt`

### Console

- `09_Operator_Console_v5.html`
- `js/` supporting files for state, workflow, persistence, rendering, events, and initialization

---

## What the console is for

The Operator Console is the execution layer. It helps the operator:

- choose a workspace folder,
- load the prompt files,
- record available LLM slots,
- generate stage request packets,
- save returned artifacts,
- track progression,
- and resume interrupted runs.

It is not an extra stage in the pipeline. It is the control surface for running the stages consistently.

---

## Workflow summary

- **Stage 01** creates the **Master Briefing**.
- **Stage 02** creates the **Architecture Spec**.
- **Stage 03** creates the orchestration artifacts and work packages.
- **Stage 04** executes one package and returns a **Delivery Report**.
- **Stage 05** reviews that package and decides whether it is accepted or must be reworked.
- **Stage 06** merges only accepted package outputs.

If a review fails, the workflow should not continue downstream until the issue is repaired or routed back upstream.

---

## How to use it

1. Open `09_Operator_Console_v5.html` in a desktop browser.
2. Select a workspace folder and the folder containing the prompt files.
3. Enter available LLM slots.
4. Run the stages in order.
5. Execute Stage 04 and Stage 05 one package at a time.
6. Merge only accepted outputs.

---

## Core principle

This project is built around strict artifact boundaries: requirements drive architecture, architecture drives orchestration, reviewed package outputs drive merge. That separation is the main value of the system.
