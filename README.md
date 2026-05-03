# Agent Autonomous Workflow

A self-directed workflow engine that plans, executes, monitors, and self-corrects multi-step AI agent tasks.

## Features

- **Automated Planning**: Breaks high-level tasks into executable steps based on task type
- **Self-Correction**: Automatically retries, replans, or skips failed steps
- **Progress Monitoring**: Real-time health, progress, and status tracking
- **Checkpointing**: Periodic saves to enable resumption after failures
- **Parallel Execution**: Optional parallel step execution for independent tasks
- **Multiple Correction Strategies**: Retry, replan, skip, fallback, or abort

## Installation

```bash
npm install agent-autonomous-workflow
```

Or use as a CLI tool:

```bash
bun install -g agent-autonomous-workflow
```

## Quick Start

### CLI Usage

```bash
# Create a new workflow from a task
bun run src/index.ts create "Research AI agent frameworks and analyze trends"

# Execute the workflow
bun run src/index.ts execute <workflow-id> --verbose

# List all workflows
bun run src/index.ts list

# Check workflow status
bun run src/index.ts status <workflow-id>

# Cancel a running workflow
bun run src/index.ts cancel <workflow-id>

# Delete a workflow
bun run src/index.ts delete <workflow-id>

# Get detailed summary
bun run src/index.ts summary <workflow-id>
```

### API Usage

```typescript
import { AutonomousWorkflowEngine, DEFAULT_CONFIG } from "agent-autonomous-workflow";

const engine = new AutonomousWorkflowEngine({
  ...DEFAULT_CONFIG,
  maxCorrections: 3,
  enableSelfCorrection: true,
  storagePath: "./my-workflows",
});

// Create a workflow
const workflow = await engine.create("Build a web scraper that extracts product prices", "Price Scraper");

// Execute it
const result = await engine.execute(workflow.id, true);

// Check results
const summary = engine.summary(workflow.id);
console.log(`Progress: ${summary.progress}%`);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AutonomousWorkflowEngine                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Planner    │  │  Executor    │  │    SelfCorrector      │  │
│  │              │  │              │  │                       │  │
│  │ - plan()     │  │ - executeStep│  │ - determineCorrection │  │
│  │ - replan()   │  │ - parallel   │  │ - applyCorrection     │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │    Store     │  │   Monitor    │  │      Config          │  │
│  │              │  │              │  │                       │  │
│  │ - save()     │  │ - progress() │  │ - maxSteps           │  │
│  │ - load()     │  │ - health()   │  │ - maxCorrections     │  │
│  │ - list()     │  │ - summary()  │  │ - defaultTimeout     │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Components

**WorkflowPlanner**
- Analyzes task description and generates executable steps
- Supports task types: research, build, monitor, process, and generic
- Generates alternative plans when steps fail

**WorkflowExecutor**
- Executes individual steps with tool inference
- Handles timeouts and error catching
- Supports parallel execution for independent steps

**WorkflowSelfCorrector**
- Analyzes failures and determines correction strategy
- Tracks correction budget per workflow
- Applies corrections: retry, skip, replan, fallback, or abort

**WorkflowMonitor**
- Calculates progress percentage
- Detects stuck workflows
- Provides health status (healthy/degraded/critical)
- Generates execution summaries

**WorkflowStore**
- Persists workflows to disk as JSON
- Supports listing, loading, and deletion
- Automatic checkpoint creation

## Workflow States

```
                    ┌─────────────┐
                    │  planning   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
              ┌──────│    ready    │──────┐
              │      └─────────────┘      │
       ┌──────▼──────┐             ┌──────▼──────┐
       │  cancelled  │             │   running   │
       └─────────────┘             └──────┬──────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
       ┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
       │  completed  │             │   paused    │             │   failed    │
       └─────────────┘             └─────────────┘             └─────────────┘
```

## Step States

- **pending**: Waiting for dependencies to complete
- **running**: Currently executing
- **completed**: Successfully finished
- **failed**: Failed and cannot be recovered
- **skipped**: Intentionally skipped by corrector

## Correction Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `retry` | Re-execute the failed step | Transient errors, timeout |
| `replan` | Generate alternative steps | Persistent failure |
| `skip` | Skip step and continue | Non-critical step with unmet deps |
| `fallback` | Mark as completed with fallback output | Graceful degradation |
| `abort` | Cancel entire workflow | Critical failure, max corrections |

## Task Type Detection

The planner automatically detects task type from keywords:

| Task Type | Keywords | Default Steps |
|----------|----------|--------------|
| Research | research, analyze | gather, extract, synthesize, report |
| Build | build, create, generate | specify, implement, test, validate, deploy |
| Monitor | monitor, track, watch | setup, collect, alert, report |
| Process | process, transform | validate-input, transform, validate-output, deliver |
| Generic | (fallback) | analyze, execute, verify, deliver |

## Configuration

```typescript
interface WorkflowConfig {
  maxSteps: number;           // Maximum steps per workflow (default: 50)
  maxCorrections: number;      // Max self-corrections before abort (default: 5)
  defaultTimeout: number;     // Step timeout in ms (default: 60000)
  enableSelfCorrection: boolean; // Enable auto-correction (default: true)
  parallelExecution: boolean;  // Execute independent steps in parallel (default: false)
  checkpointInterval: number; // Save every N steps (default: 5)
  storagePath: string;        // Workflow persistence directory (default: "./workflows")
}
```

## API Reference

### AutonomousWorkflowEngine

#### `create(task: string, name?: string): Promise<WorkflowPlan>`
Creates a new workflow from a task description.

#### `execute(workflowId: string, verbose?: boolean): Promise<WorkflowPlan>`
Executes a workflow by ID.

#### `get(workflowId: string): WorkflowPlan | null`
Retrieves a workflow by ID.

#### `list(): WorkflowPlan[]`
Lists all persisted workflows.

#### `cancel(workflowId: string): WorkflowPlan | null`
Cancels a running workflow.

#### `delete(workflowId: string): boolean`
Deletes a workflow.

#### `summary(workflowId: string): Record<string, unknown> | null`
Gets execution summary for a workflow.

### WorkflowPlanner

#### `plan(task: string, context?: Record<string, unknown>): WorkflowStep[]`
Breaks a task into executable steps.

#### `replan(failedStep: WorkflowStep, context: Record<string, unknown>): WorkflowStep[]`
Generates alternative steps for a failed step.

### WorkflowMonitor

#### `getProgress(workflow: WorkflowPlan): number`
Returns progress percentage (0-100).

#### `getHealth(workflow: WorkflowPlan): "healthy" | "degraded" | "critical"`
Returns workflow health status.

#### `getSummary(workflow: WorkflowPlan): Record<string, unknown>`
Returns detailed execution summary.

## License

MIT
