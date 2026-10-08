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
