/// Class used to define the different states of a node
export default class AStarNodeState {
	/// No specific state
	static none = new AStarNodeState(0);
	/// In the open list
	static isOpen = new AStarNodeState(1);
	/// In the closed list
	static isClosed = new AStarNodeState(2);
	/// Is in the final path
	static isPath = new AStarNodeState(3);

	/// Initialize a direction with a raw value
	///
	/// - Parameter rawValue: The int value for the direction
	constructor(rawValue) {
		this.rawValue = rawValue;
	}
}
