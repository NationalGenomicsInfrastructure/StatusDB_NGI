// The demux realm's latest attempt of each flowcell, keyed by flowcell ID, for
// the flowcell list in genomics-status: the request it ran and each step's status.
function(doc) {
  if (doc.type === "plan_status" && doc.realm === "dmx_realm"
      && doc.scope && doc.scope.kind === "flowcell" && doc.attempt) {
    var steps = {};
    for (var stepId in doc.steps) {
      // The step's outcome once it has one, else its current state
      steps[stepId] = doc.steps[stepId].outcome || doc.steps[stepId].state;
    }
    emit(doc.scope.id, {
      plan_generation: doc.attempt.plan_generation,
      run_token: doc.attempt.run_token,
      state: doc.attempt.state,
      steps: steps,
    });
  }
}
