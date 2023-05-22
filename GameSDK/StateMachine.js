/// Simple state machine implementation
export default class StateMachine {
	/// Initialize a state machine with an initial state
	///
	/// - Parameter initialState: The state to start the machine in
	constructor(initialState) {
		this.currentState = initialState;
	}
	/// Method to make the state machine transition to another state
	///
	/// - Parameter state: The state to transition to
	transition(state) {
		this.currentState.transition(
			state,
			function (state) {
				this.currentState = state;
			}.bind(this)
		);
	}
	/// Method used to render the current state
	render() {
		if (this.currentState) {
			this.currentState.render();
		}
	}
}
