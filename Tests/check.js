// Log FAIL and mark the process exit code instead of throwing, so one
// failed check doesn't hide the rest of a run's evidence.
function check(cond, msg) {
	if (!cond) {
		process.exitCode = 1;
		console.error("FAIL: " + msg);
	}
	return cond;
}
module.exports = { check };
