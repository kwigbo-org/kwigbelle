import GridCoordinates from "../GridUtil/GridCoordinates.js";

/// Class used to represent a node in a grid for AStar evaluation
export default class AStarNode {
	/// Initializer for an `AStarNode`
	///
	/// - Parameters:
	///		- coordinates: The coordinates of the `AStartNode`
	///		- gCost: Distance from start coordinates
	///		- hCost: Distance from end coordinates
	constructor(coordinates, gCost, hCost) {
		this.coordinates = coordinates;
		this.parentNode = null;
		this.gCost = gCost;
		this.hCost = hCost;
	}

	/// FCost of the current node
	get fCost() {
		return this.hCost + this.gCost;
	}

	isDiagonalFrom(node) {
		return false;
	}

	/// Check if another node is the same as the current
	///
	/// - Parameter node: The node to test equality with
	/// - Returns: True if the nodes are the same.
	isEqual(node) {
		return this.coordinates.isEqual(node.coordinates);
	}
}
