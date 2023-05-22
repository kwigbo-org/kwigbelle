import GridCoordinates from "../GridUtil/GridCoordinates.js";
import GridSize from "../GridUtil/GridSize.js";
import GridArray from "../GridUtil/GridArray.js";
import Direction from "../Direction.js";
import TileMap from "../TileMap.js";
import AStarNode from "./AStarNode.js";
import AStarNodeState from "./AStarNodeState.js";

/// Class used to find paths in a grid
export default class AStar {
	/// Initialize with a tilemap
	///
	/// - Parameter tileMap: The tile map used for evaluation
	constructor(tileMap) {
		this.tileMap = tileMap;
		this.gridSize = tileMap.gridSize;
		this.debug = false;
	}

	/// Start a carve operation to a specific point
	///
	/// - Parameters:
	///		- startCoordinates: The coordinates to start at
	///		- endCoordinates: The coordinates to end at
	///		- complete: The function to call when complete
	findPath(startCoordinates, endCoordinates, complete) {
		this.complete = complete;

		this.open = [];
		this.closed = [];

		this.startNode = new AStarNode(
			startCoordinates,
			0,
			startCoordinates.distanceTo(endCoordinates)
		);
		this.endNode = new AStarNode(
			endCoordinates,
			endCoordinates.distanceTo(startCoordinates),
			0
		);
		this.generateGridArray();

		this.open.push(this.startNode);
		this.carve();
	}

	/// Method to generate a grid array for tracking node costs
	generateGridArray() {
		if (this.debug) {
			this.debugGridArray = new GridArray(this.gridSize, 0);
		}
		this.gridArray = new GridArray(this.gridSize, null);
		for (let column = 0; column < this.gridSize.columns; column++) {
			for (let row = 0; row < this.gridSize.rows; row++) {
				const coordinates = new GridCoordinates(column, row);
				const node = new AStarNode(
					coordinates,
					coordinates.distanceTo(this.startNode.coordinates),
					coordinates.distanceTo(this.endNode.coordinates)
				);
				this.gridArray.setElementAt(node, coordinates);
			}
		}
	}

	/// Method to allow for drawing what the algorithm is doing
	updateDebugGridArray() {
		for (let column = 0; column < this.gridSize.columns; column++) {
			for (let row = 0; row < this.gridSize.rows; row++) {
				const coordinates = new GridCoordinates(column, row);
				const node = this.gridArray.getElementAt(coordinates);
				this.debugGridArray.setElementAt(
					this.nodeState(node).rawValue,
					coordinates
				);
			}
		}
	}

	/// Get the node debug state
	///
	/// - Parameters
	///		- node: The node to check the state for.
	/// - Returns: The node debug state.
	nodeState(node) {
		for (const index in this.open) {
			const currentNode = this.open[index];
			if (currentNode.isEqual(node)) {
				return AStarNodeState.isOpen;
			}
		}
		for (const index in this.closed) {
			const currentNode = this.closed[index];
			if (currentNode.isEqual(node)) {
				return AStarNodeState.isClosed;
			}
		}
		return AStarNodeState.none;
	}

	/// Method used to recursivly carve to a given coordinates
	carve() {
		if (this.debug) {
			this.updateDebugGridArray();
		}
		const lowestCostIndex = this.lowestCost(this.open);
		if (lowestCostIndex === null) {
			return;
		}
		const lowestCostNode = this.open.splice(lowestCostIndex, 1)[0];
		this.closed.push(lowestCostNode);
		if (lowestCostNode.isEqual(this.endNode)) {
			this.carveComplete();
			return;
		}
		const neighborNodes = this.gridArray.getNeighborsForCoordinates(
			lowestCostNode.coordinates
		);
		for (const index in neighborNodes) {
			const neighbor = neighborNodes[index];
			const isClosed =
				this.nodeState(neighbor) === AStarNodeState.isClosed;
			const isWalkable = this.tileMap.isWalkable(neighbor.coordinates);
			if (isClosed || !isWalkable) {
				continue;
			}
			const isOpen = this.nodeState(neighbor) === AStarNodeState.isOpen;
			const newMoveCost =
				lowestCostNode.gCost +
				lowestCostNode.coordinates.distanceTo(neighbor.coordinates);

			const isPathShorter = newMoveCost < neighbor.gCost;
			if (!isOpen || isPathShorter) {
				neighbor.gCost = newMoveCost;
				neighbor.hCost = neighbor.coordinates.distanceTo(
					this.endNode.coordinates
				);
				neighbor.parentNode = lowestCostNode;
				if (!isOpen) {
					this.open.push(neighbor);
				}
				/// Update the "neighbor" in the grid array based on changes
				this.gridArray.setElementAt(neighbor, neighbor.coordinates);
			}
		}
		if (this.open.length > 0) {
			this.carve();
		} else {
			this.carveComplete();
		}
	}

	/// Called when the carve operation has completed
	carveComplete() {
		let pathArray = [];
		let currentNode = this.gridArray.getElementAt(this.endNode.coordinates);
		while (!currentNode.isEqual(this.startNode)) {
			if (this.debug) {
				this.debugGridArray.setElementAt(
					AStarNodeState.isPath.rawValue,
					currentNode.coordinates
				);
			}
			pathArray.push(currentNode);
			currentNode = currentNode.parentNode;
		}
		this.complete(pathArray.reverse());
	}

	/// Get the node with the lowest cost in an array of nodes
	///
	/// - Parameter nodes: The array of nodes to check
	/// - Returns: The index of the lowest cost node or null.
	lowestCost(nodes) {
		var lowestCostIndex = null;
		if (nodes.length <= 0) {
			return lowestCostIndex;
		}
		for (const index in nodes) {
			const node = nodes[index];
			if (lowestCostIndex === null) {
				lowestCostIndex = index;
			} else {
				const lowestNode = nodes[lowestCostIndex];
				if (
					(node.fCost < lowestNode.fCost ||
						node.fCost === lowestNode.fCost) &&
					node.hCost < lowestNode.hCost
				) {
					lowestCostIndex = index;
				}
			}
		}
		return lowestCostIndex;
	}
}
