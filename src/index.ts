#!/usr/bin/env bun
/**
 * agent-autonomous-workflow - Self-directed workflow engine
 * Plans, executes, monitors, and self-corrects multi-step agent tasks
 */

import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  tool?: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  attempts: number;
  maxAttempts: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  dependencies: string[];
}

export interface WorkflowPlan {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: "planning" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  context: Record<string, unknown>;
  results: Record<string, unknown>;
  corrections: number;
  maxCorrections: number;
}

export interface WorkflowConfig {
  maxSteps: number;
  maxCorrections: number;
  defaultTimeout: number;
  enableSelfCorrection: boolean;
  parallelExecution: boolean;
  checkpointInterval: number;
  storagePath: string;
}

export const DEFAULT_CONFIG: WorkflowConfig = {
  maxSteps: 50,
  maxCorrections: 5,
  defaultTimeout: 60000,
  enableSelfCorrection: true,
  parallelExecution: false,
  checkpointInterval: 5,
  storagePath: "./workflows",
};

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  timestamp: number;
}

export interface CorrectionStrategy {
  type: "retry" | "replan" | "skip" | "fallback" | "abort";
  reason: string;
  newSteps?: WorkflowStep[];
  fallbackOutput?: unknown;
}

class WorkflowStore {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    mkdirSync(storagePath, { recursive: true });
  }

  save(workflow: WorkflowPlan): void {
    const path = join(this.storagePath, `${workflow.id}.json`);
    writeFileSync(path, JSON.stringify(workflow, null, 2));
  }

  load(id: string): WorkflowPlan | null {
    const path = join(this.storagePath, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  list(): WorkflowPlan[] {
    const { readdirSync } = require("fs");
    const files = readdirSync(this.storagePath).filter((f: string) => f.endsWith(".json"));
    return files
      .map((f: string) => {
        const wf = this.load(f.replace(".json", ""));
        return wf;
      })
      .filter(Boolean)
      .sort((a: WorkflowPlan, b: WorkflowPlan) => b.createdAt - a.createdAt);
  }

  delete(id: string): void {
    const { unlinkSync } = require("fs");
    const path = join(this.storagePath, `${id}.json`);
    if (existsSync(path)) unlinkSync(path);
  }
}

export class WorkflowPlanner {
  /**
   * Breaks a high-level task into executable steps
   */
  static plan(task: string, context: Record<string, unknown> = {}): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    const task_lower = task.toLowerCase();

    // Decomposition logic based on task type
    if (task_lower.includes("research") || task_lower.includes("analyze")) {
      steps.push(this.createStep("gather", "Gather initial information", { task }, ["search"]));
      steps.push(this.createStep("extract", "Extract key findings", { task }, ["gather"]));
      steps.push(this.createStep("synthesize", "Synthesize results", { task }, ["extract"]));
      steps.push(this.createStep("report", "Generate report", { task }, ["synthesize"]));
    } else if (task_lower.includes("build") || task_lower.includes("create") || task_lower.includes("generate")) {
      steps.push(this.createStep("specify", "Create specification", { task }, []));
      steps.push(this.createStep("implement", "Implement core logic", { task }, ["specify"]));
      steps.push(this.createStep("test", "Run tests", { task }, ["implement"]));
      steps.push(this.createStep("validate", "Validate output", { task }, ["test"]));
      steps.push(this.createStep("deploy", "Deploy result", { task }, ["validate"]));
    } else if (task_lower.includes("monitor") || task_lower.includes("track") || task_lower.includes("watch")) {
      steps.push(this.createStep("setup", "Setup monitoring", { task }, []));
      steps.push(this.createStep("collect", "Collect metrics", { task }, ["setup"]));
      steps.push(this.createStep("alert", "Process alerts", { task }, ["collect"]));
      steps.push(this.createStep("report", "Generate status report", { task }, ["alert"]));
    } else if (task_lower.includes("process") || task_lower.includes("transform")) {
      steps.push(this.createStep("validate-input", "Validate input data", { task }, []));
      steps.push(this.createStep("transform", "Transform data", { task }, ["validate-input"]));
      steps.push(this.createStep("validate-output", "Validate transformed data", { task }, ["transform"]));
      steps.push(this.createStep("deliver", "Deliver result", { task }, ["validate-output"]));
    } else {
      // Default generic workflow
      steps.push(this.createStep("analyze", "Analyze task requirements", { task }, []));
      steps.push(this.createStep("execute", "Execute primary action", { task }, ["analyze"]));
      steps.push(this.createStep("verify", "Verify results", { task }, ["execute"]));
      steps.push(this.createStep("deliver", "Deliver output", { task }, ["verify"]));
    }

    return steps;
  }

  private static createStep(
    id: string,
    name: string,
    input: Record<string, unknown>,
    dependencies: string[]
  ): WorkflowStep {
    return {
      id,
      name,
      description: name,
      input,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      dependencies,
    };
  }

  /**
   * Replans when a step fails, generating alternative paths
   */
  static replan(failedStep: WorkflowStep, context: Record<string, unknown>): WorkflowStep[] {
    const alternatives: WorkflowStep[] = [];
    const task_lower = (context.task as string || "").toLowerCase();

    // Strategy: create simplified alternative steps
    if (failedStep.id === "implement") {
      alternatives.push({
        ...this.createStep("implement-simple", "Implement simplified version", context, ["specify"]),
        maxAttempts: 1,
      });
      alternatives.push({
        ...this.createStep("stub", "Create stub with TODO comments", context, ["specify"]),
        maxAttempts: 1,
      });
    } else if (failedStep.id === "gather" || failedStep.id === "search") {
      alternatives.push({
        ...this.createStep("manual-research", "Manual research fallback", context, []),
        maxAttempts: 2,
      });
    } else if (failedStep.id === "test") {
      alternatives.push({
        ...this.createStep("manual-review", "Manual code review", context, ["implement"]),
        maxAttempts: 1,
      });
    } else {
      // Generic skip and continue
      alternatives.push({
        ...this.createStep(`${failedStep.id}-retry`, `Retry ${failedStep.name}`, context, failedStep.dependencies),
        maxAttempts: 1,
      });
    }

    return alternatives;
  }
}

export class WorkflowExecutor {
  private timeout: number;

  constructor(timeout: number = 60000) {
    this.timeout = timeout;
  }

  /**
   * Execute a single step with the given tool
   */
  async executeStep(step: WorkflowStep, context: Record<string, unknown>): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ToolCall[] = [];
    step.attempts++;

    try {
      const tool = step.tool || this.inferTool(step);
      const input = { ...step.input, context };

      // Simulate tool execution with timing
      const result = await this.callTool(tool, input);
      toolCalls.push({
        tool,
        input,
        output: result,
        timestamp: Date.now(),
      });

      return {
        success: true,
        output: result,
        duration: Date.now() - startTime,
        toolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toolCalls.push({
        tool: step.tool || "unknown",
        input: step.input,
        error: errorMessage,
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
        toolCalls,
      };
    }
  }

  private inferTool(step: WorkflowStep): string {
    const name_lower = step.name.toLowerCase();
    if (name_lower.includes("search") || name_lower.includes("gather")) return "web_search";
    if (name_lower.includes("implement") || name_lower.includes("create") || name_lower.includes("build")) return "code_write";
    if (name_lower.includes("test") || name_lower.includes("verify")) return "test_runner";
    if (name_lower.includes("deploy") || name_lower.includes("publish")) return "deployer";
    if (name_lower.includes("report") || name_lower.includes("generate")) return "report_generator";
    if (name_lower.includes("analyze") || name_lower.includes("extract")) return "analyzer";
    return "generic_executor";
  }

  private async callTool(tool: string, input: Record<string, unknown>): Promise<unknown> {
    // Simulate tool execution with realistic delays
    const delay = Math.random() * 500 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Generate realistic output based on tool
    switch (tool) {
      case "web_search":
        return {
          results: [
            { title: "Result 1", url: "https://example.com/1", snippet: "Relevant information found" },
            { title: "Result 2", url: "https://example.com/2", snippet: "Additional context" },
          ],
          count: 2,
        };
      case "code_write":
        return { success: true, file: input.task + ".ts", linesWritten: Math.floor(Math.random() * 100) + 20 };
      case "test_runner":
        return { passed: true, tests: 5, failures: 0, duration: Math.floor(Math.random() * 1000) + 200 };
      case "deployer":
        return { deployed: true, url: "https://deploy.example.com/" + Date.now(), duration: Math.floor(Math.random() * 2000) + 500 };
      case "report_generator":
        return { format: "markdown", content: "# Report\n\nGenerated at " + new Date().toISOString(), lines: 45 };
      case "analyzer":
        return { insights: ["Key insight 1", "Key insight 2", "Key insight 3"], confidence: 0.87 };
      default:
        return { success: true, message: "Step completed", timestamp: Date.now() };
    }
  }

  /**
   * Execute multiple steps in parallel if enabled
   */
  async executeParallel(steps: WorkflowStep[], context: Record<string, unknown>): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();
    const promises = steps.map(async (step) => {
      const result = await this.executeStep(step, context);
      results.set(step.id, result);
    });
    await Promise.all(promises);
    return results;
  }
}

export class WorkflowMonitor {
  /**
   * Check if a step has timed out
   */
  static hasTimedOut(step: WorkflowStep, maxTimeout: number): boolean {
    if (!step.startedAt) return false;
    return Date.now() - step.startedAt > maxTimeout;
  }

  /**
   * Detect if a workflow is stuck (no progress)
   */
  static isStuck(workflow: WorkflowPlan, stuckThresholdMs: number = 300000): boolean {
    if (workflow.status !== "running" || !workflow.startedAt) return false;
    const pending = workflow.steps.filter((s) => s.status === "pending" || s.status === "running");
    if (pending.length === 0) return false;
    return Date.now() - workflow.startedAt > stuckThresholdMs;
  }

  /**
   * Calculate workflow progress percentage
   */
  static getProgress(workflow: WorkflowPlan): number {
    const total = workflow.steps.length;
    if (total === 0) return 0;
    const completed = workflow.steps.filter(
      (s) => s.status === "completed" || s.status === "skipped" || s.status === "failed"
    ).length;
    return Math.round((completed / total) * 100);
  }

  /**
   * Get workflow health status
   */
  static getHealth(workflow: WorkflowPlan): "healthy" | "degraded" | "critical" {
    const failed = workflow.steps.filter((s) => s.status === "failed").length;
    const running = workflow.steps.filter((s) => s.status === "running").length;
    const total = workflow.steps.length;

    if (failed / total > 0.5) return "critical";
    if (failed / total > 0.25 || running === 0 && workflow.status === "running") return "degraded";
    return "healthy";
  }

  /**
   * Generate execution summary
   */
  static getSummary(workflow: WorkflowPlan): Record<string, unknown> {
    const stepsByStatus = workflow.steps.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const totalAttempts = workflow.steps.reduce((sum, s) => sum + s.attempts, 0);
    const totalDuration = workflow.completedAt && workflow.startedAt
      ? workflow.completedAt - workflow.startedAt
      : workflow.startedAt
      ? Date.now() - workflow.startedAt
      : 0;

    return {
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      progress: this.getProgress(workflow),
      health: this.getHealth(workflow),
      stepsByStatus,
      totalSteps: workflow.steps.length,
      totalAttempts,
      corrections: workflow.corrections,
      duration: totalDuration,
      createdAt: new Date(workflow.createdAt).toISOString(),
      startedAt: workflow.startedAt ? new Date(workflow.startedAt).toISOString() : null,
      completedAt: workflow.completedAt ? new Date(workflow.completedAt).toISOString() : null,
    };
  }
}

export class WorkflowSelfCorrector {
  private maxCorrections: number;

  constructor(maxCorrections: number = 5) {
    this.maxCorrections = maxCorrections;
  }

  /**
   * Determine correction strategy for a failed step
   */
  determineCorrection(
    failedStep: WorkflowStep,
    workflow: WorkflowPlan,
    context: Record<string, unknown>
  ): CorrectionStrategy | null {
    if (workflow.corrections >= this.maxCorrections) {
      return { type: "abort", reason: "Maximum corrections exceeded" };
    }

    // Check if step should be retried
    if (failedStep.attempts < failedStep.maxAttempts) {
      return {
        type: "retry",
        reason: `Attempt ${failedStep.attempts} failed, retrying (${failedStep.attempts}/${failedStep.maxAttempts})`,
      };
    }

    // Check if we can skip this step
    const dependents = workflow.steps.filter((s) => s.dependencies.includes(failedStep.id));
    const allDependentsFailed = dependents.every((s) => s.status === "failed");
    if (!allDependentsFailed && dependents.length > 0) {
      return {
        type: "skip",
        reason: `Step has unmet dependencies but other paths exist`,
        fallbackOutput: { skipped: true, reason: "Self-correction skip" },
      };
    }

    // Replan for complex failures
    if (failedStep.attempts >= failedStep.maxAttempts) {
      const alternatives = WorkflowPlanner.replan(failedStep, context);
      if (alternatives.length > 0) {
        return {
          type: "replan",
          reason: `Max attempts reached, generating alternative plan`,
          newSteps: alternatives,
        };
      }
    }

    // Last resort: abort
    return {
      type: "abort",
      reason: `Step ${failedStep.id} failed after ${failedStep.attempts} attempts with no recovery path`,
    };
  }

  /**
   * Apply correction to workflow
   */
  applyCorrection(
    workflow: WorkflowPlan,
    correction: CorrectionStrategy
  ): WorkflowPlan {
    workflow.corrections++;

    switch (correction.type) {
      case "retry":
        const retryStep = workflow.steps.find((s) => s.id === correction.reason.split(" ")[0] || s.status === "failed");
        if (retryStep) {
          retryStep.status = "pending";
          retryStep.error = undefined;
        }
        break;

      case "skip":
        workflow.steps
          .filter((s) => s.status === "failed")
          .forEach((s) => {
            s.status = "skipped";
            s.output = correction.fallbackOutput;
          });
        break;

      case "replan":
        if (correction.newSteps) {
          workflow.steps = workflow.steps.concat(correction.newSteps as WorkflowStep[]);
        }
        break;

      case "fallback":
        workflow.steps
          .filter((s) => s.status === "failed")
          .forEach((s) => {
            s.output = correction.fallbackOutput;
            s.status = "completed";
          });
        break;

      case "abort":
        workflow.status = "failed";
        workflow.completedAt = Date.now();
        workflow.steps
          .filter((s) => s.status === "pending")
          .forEach((s) => {
            s.status = "skipped";
          });
        break;
    }

    return workflow;
  }
}

export class AutonomousWorkflowEngine {
  private store: WorkflowStore;
  private executor: WorkflowExecutor;
  private config: WorkflowConfig;

  constructor(config: WorkflowConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.store = new WorkflowStore(config.storagePath);
    this.executor = new WorkflowExecutor(config.defaultTimeout);
  }

  /**
   * Create a new workflow from a task description
   */
  async create(task: string, name?: string): Promise<WorkflowPlan> {
    const plan = WorkflowPlanner.plan(task);

    const workflow: WorkflowPlan = {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || task.slice(0, 50),
      description: task,
      steps: plan,
      status: "ready",
      createdAt: Date.now(),
      context: { task, originalTask: task },
      results: {},
      corrections: 0,
      maxCorrections: this.config.maxCorrections,
    };

    this.store.save(workflow);
    return workflow;
  }

  /**
   * Execute a workflow
   */
  async execute(workflowId: string, verbose: boolean = false): Promise<WorkflowPlan> {
    let workflow = this.store.load(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    if (workflow.status === "completed" || workflow.status === "failed") {
      throw new Error(`Workflow ${workflowId} is already ${workflow.status}`);
    }

    workflow.status = "running";
    workflow.startedAt = Date.now();
    this.store.save(workflow);

    const corrector = new WorkflowSelfCorrector(workflow.maxCorrections);

    try {
      while (workflow.status === "running") {
        // Find next step with all dependencies met
        const nextStep = this.findNextExecutableStep(workflow);
        if (!nextStep) {
          // Check if workflow is complete
          const incomplete = workflow.steps.filter(
            (s) => s.status === "pending" && s.status !== "skipped"
          );
          if (incomplete.length === 0) {
            workflow.status = "completed";
            workflow.completedAt = Date.now();
          } else {
            workflow.status = "failed";
            workflow.completedAt = Date.now();
          }
          break;
        }

        // Execute step
        if (verbose) console.log(`[${workflowId}] Executing step: ${nextStep.name}`);
        nextStep.status = "running";
        nextStep.startedAt = Date.now();
        this.store.save(workflow);

        const result = await this.executor.executeStep(nextStep, workflow.context);
        nextStep.output = result.output;
        nextStep.completedAt = Date.now();

        if (result.success) {
          nextStep.status = "completed";
          workflow.results[nextStep.id] = result.output;
          if (verbose) console.log(`[${workflowId}] Step ${nextStep.name} completed`);
        } else {
          nextStep.status = "failed";
          nextStep.error = result.error;
          if (verbose) console.log(`[${workflowId}] Step ${nextStep.name} failed: ${result.error}`);

          if (this.config.enableSelfCorrection) {
            const correction = corrector.determineCorrection(nextStep, workflow, workflow.context);
            if (correction) {
              workflow = corrector.applyCorrection(workflow, correction);
              if (verbose) console.log(`[${workflowId}] Correction applied: ${correction.type}`);
            }
          }

          if (workflow.status !== "running") {
            break;
          }
        }

        // Checkpoint
        if (workflow.steps.indexOf(nextStep) % this.config.checkpointInterval === 0) {
          this.store.save(workflow);
        }
      }
    } catch (error) {
      workflow.status = "failed";
      workflow.completedAt = Date.now();
      if (verbose) console.error(`[${workflowId}] Workflow failed:`, error);
    }

    this.store.save(workflow);
    return workflow;
  }

  private findNextExecutableStep(workflow: WorkflowPlan): WorkflowStep | null {
    return workflow.steps.find((step) => {
      if (step.status !== "pending") return false;
      // Check all dependencies are satisfied
      return step.dependencies.every((depId) => {
        const dep = workflow.steps.find((s) => s.id === depId);
        return dep && (dep.status === "completed" || dep.status === "skipped");
      });
    });
  }

  /**
   * Get workflow by ID
   */
  get(workflowId: string): WorkflowPlan | null {
    return this.store.load(workflowId);
  }

  /**
   * List all workflows
   */
  list(): WorkflowPlan[] {
    return this.store.list();
  }

  /**
   * Cancel a running workflow
   */
  cancel(workflowId: string): WorkflowPlan | null {
    const workflow = this.store.load(workflowId);
    if (!workflow) return null;
    workflow.status = "cancelled";
    workflow.completedAt = Date.now();
    workflow.steps
      .filter((s) => s.status === "pending" || s.status === "running")
      .forEach((s) => {
        s.status = "skipped";
      });
    this.store.save(workflow);
    return workflow;
  }

  /**
   * Delete a workflow
   */
  delete(workflowId: string): boolean {
    const workflow = this.store.load(workflowId);
    if (!workflow) return false;
    this.store.delete(workflowId);
    return true;
  }

  /**
   * Get execution summary
   */
  summary(workflowId: string): Record<string, unknown> | null {
    const workflow = this.store.load(workflowId);
    if (!workflow) return null;
    return WorkflowMonitor.getSummary(workflow);
  }
}

// CLI
const program = new Command();
program
  .name("agent-autonomous-workflow")
  .description("Self-directed workflow engine that plans, executes, monitors, and self-corrects multi-step agent tasks")
  .version("1.0.0");

program
  .command("create")
  .description("Create a new workflow from a task description")
  .argument("<task>", "Task description")
  .option("-n, --name <name>", "Workflow name")
  .action(async (task: string, opts: { name?: string }) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const workflow = await engine.create(task, opts.name);
    console.log(`Created workflow: ${workflow.id}`);
    console.log(`  Name: ${workflow.name}`);
    console.log(`  Steps: ${workflow.steps.length}`);
    console.log(`  Status: ${workflow.status}`);
  });

program
  .command("execute")
  .description("Execute a workflow")
  .argument("<workflow-id>", "Workflow ID")
  .option("-v, --verbose", "Verbose output")
  .action(async (workflowId: string, opts: { verbose?: boolean }) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    try {
      const workflow = await engine.execute(workflowId, opts.verbose);
      console.log(`Workflow ${workflowId} completed with status: ${workflow.status}`);
      console.log(`Progress: ${WorkflowMonitor.getProgress(workflow)}%`);
      console.log(`Corrections: ${workflow.corrections}`);
    } catch (e) {
      console.error(`Error: ${e}`);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all workflows")
  .action(async () => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const workflows = engine.list();
    if (workflows.length === 0) {
      console.log("No workflows found");
      return;
    }
    console.log(`Found ${workflows.length} workflows:\n`);
    workflows.forEach((wf) => {
      console.log(`  ${wf.id}`);
      console.log(`    Name: ${wf.name}`);
      console.log(`    Status: ${wf.status}`);
      console.log(`    Progress: ${WorkflowMonitor.getProgress(wf)}%`);
      console.log(`    Steps: ${wf.steps.length}`);
      console.log();
    });
  });

program
  .command("status")
  .description("Get workflow status")
  .argument("<workflow-id>", "Workflow ID")
  .action(async (workflowId: string) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const summary = engine.summary(workflowId);
    if (!summary) {
      console.error(`Workflow ${workflowId} not found`);
      process.exit(1);
    }
    console.log(`Workflow: ${summary.id}`);
    console.log(`  Name: ${summary.name}`);
    console.log(`  Status: ${summary.status}`);
    console.log(`  Health: ${summary.health}`);
    console.log(`  Progress: ${summary.progress}%`);
    console.log(`  Steps: ${summary.totalSteps}`);
    console.log(`  Corrections: ${summary.corrections}`);
    console.log(`  Duration: ${summary.duration}ms`);
    console.log(`  Created: ${summary.createdAt}`);
  });

program
  .command("cancel")
  .description("Cancel a running workflow")
  .argument("<workflow-id>", "Workflow ID")
  .action(async (workflowId: string) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const workflow = engine.cancel(workflowId);
    if (!workflow) {
      console.error(`Workflow ${workflowId} not found`);
      process.exit(1);
    }
    console.log(`Workflow ${workflowId} cancelled`);
  });

program
  .command("delete")
  .description("Delete a workflow")
  .argument("<workflow-id>", "Workflow ID")
  .action(async (workflowId: string) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const deleted = engine.delete(workflowId);
    if (!deleted) {
      console.error(`Workflow ${workflowId} not found`);
      process.exit(1);
    }
    console.log(`Workflow ${workflowId} deleted`);
  });

program
  .command("summary")
  .description("Get detailed execution summary")
  .argument("<workflow-id>", "Workflow ID")
  .action(async (workflowId: string) => {
    const engine = new AutonomousWorkflowEngine(DEFAULT_CONFIG);
    const wf = engine.get(workflowId);
    if (!wf) {
      console.error(`Workflow ${workflowId} not found`);
      process.exit(1);
    }
    console.log("\n=== Workflow Details ===");
    console.log(`ID: ${wf.id}`);
    console.log(`Name: ${wf.name}`);
    console.log(`Description: ${wf.description}`);
    console.log(`Status: ${wf.status}`);
    console.log(`Corrections: ${wf.corrections}/${wf.maxCorrections}`);
    console.log("\n=== Steps ===");
    wf.steps.forEach((step) => {
      console.log(`\n  [${step.id}] ${step.name}`);
      console.log(`    Status: ${step.status}`);
      console.log(`    Attempts: ${step.attempts}/${step.maxAttempts}`);
      if (step.error) console.log(`    Error: ${step.error}`);
      if (step.output) console.log(`    Output: ${JSON.stringify(step.output).slice(0, 100)}...`);
    });
    console.log("\n=== Results ===");
    Object.entries(wf.results).forEach(([stepId, result]) => {
      console.log(`  ${stepId}: ${JSON.stringify(result).slice(0, 100)}`);
    });
  });

program.parse(process.argv);
