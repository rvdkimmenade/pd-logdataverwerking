# Execution plans

Use an execution plan for changes spanning multiple services, schema migrations, new infrastructure or material architectural changes.

Store active plans in `.agent/plans/`. A plan must be self-contained and include:

1. Goal and user-visible outcome.
2. Current situation and relevant files.
3. Scope and explicit non-goals.
4. Design choices and constraints.
5. Ordered implementation steps.
6. Contract and migration changes.
7. Test and verification approach.
8. Reliability, security and rollback considerations.
9. Progress checklist.
10. Decisions and unexpected findings.

Update the plan while executing it. Record actual outcomes instead of leaving it as an initial proposal.


## Phase-aware plans

An implementation ExecPlan must name exactly one phase from `docs/implementation/roadmap.md`.

It must copy the phase's deliverables, tests and exit criteria into a checklist. A phase is not complete until:

- all required artifacts exist;
- automated checks pass from a clean checkout;
- the documented demonstration succeeds;
- relevant contracts and architecture documents match the implementation;
- evidence is recorded in `docs/implementation/status.md`;
- open defects have been fixed or explicitly accepted by a human owner.

If a required decision is unresolved, record it and stop at the phase gate. Do not silently choose a technology, weaken a test or defer a mandatory requirement.
