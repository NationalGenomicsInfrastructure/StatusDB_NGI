// The demux realm's plan of each flowcell, keyed by flowcell ID, for the
// flowcell list in genomics-status: the run request and the plan's last steps.
function(doc) {
  if (doc.realm === "dmx_realm" && doc.scope && doc.scope.kind === "flowcell") {
    var steps = (doc.plan && doc.plan.steps) || [];
    // The last steps are those no other step depends on: a lane is done when
    // all of its last steps are
    var dependedOn = {};
    steps.forEach(function(step) {
      (step.deps || []).forEach(function(dep) {
        dependedOn[dep] = true;
      });
    });
    var lastSteps = steps.filter(function(step) {
      return !dependedOn[step.step_id];
    }).map(function(step) {
      return step.step_id;
    });

    emit(doc.scope.id, {
      schema_version: doc.schema_version,
      status: doc.status,
      plan_generation: doc.plan_generation,
      run_token: doc.run_token,
      executed_run_token: doc.executed_run_token,
      run_requested_at: doc.run_requested_at || doc.created_at,
      // Why the realm made no steps, when it did not
      reason: (doc.preview && doc.preview.reason) || doc.notes || null,
      last_steps: lastSteps,
    });
  }
}
