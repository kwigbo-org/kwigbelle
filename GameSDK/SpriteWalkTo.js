import Point from "./Geometry/Point.js";

/// Class used to manage the movement along a given path of coordinates
export default class SpriteWalkTo {
	/// Initialze a new SpriteWalkTo
	///
	/// - Parameters:
	///		- sprite: The sprite to walk along the path
	///		- map: The tile map the sprite will walk in
	///		- walkPath: Array of `GridCoordinates` to walk
	///		- complete: Function called when the path walk is complete
	constructor(sprite, map, walkPath, complete) {
		this.sprite = sprite;
		this.map = map;
		this.walkPath = walkPath;
		this.ignoreCoordinates = [];
		this.complete = complete;
		this.updateWalkTo();
	}

	/// Method used to ignore specific coordinates in a path
	///
	/// - Parameter coordinates: The coordinates to check the ignore list for
	/// - Returns: True if the given coords are in the ignore list
	shouldIgnoreCoordinates(coordinates) {
		return (
			this.ignoreCoordinates.filter(function (current) {
				if (current.isEqual(coordinates)) {
					return current;
				}
			}).length > 0
		);
	}
	/// Method called each frame to update the position
	update() {
		if (this.nextPosition) {
			this.sprite.moveTo(this.nextPosition);
			this.walkNext();
		}
	}

	/// Check the walk path and move to the next cell
	updateWalkTo() {
		if (this.walkPath && this.walkPath.length > 0) {
			const nextCoordinates = this.walkPath[0].coordinates;
			if (this.shouldIgnoreCoordinates(nextCoordinates)) {
				this.walkPath.shift();
				this.updateWalkTo();
				return;
			}
			this.nextInPath = nextCoordinates;
			const nextPosition = this.map.centerPointForCoordinates(
				this.nextInPath
			);
			let newPoint = new Point(
				nextPosition.x +
					this.map.viewPort.origin.x -
					this.map.canvas.width * 0.5 +
					this.map.viewPort.size.width * 0.5,
				nextPosition.y +
					this.map.viewPort.origin.y -
					this.map.canvas.height * 0.5 +
					this.map.viewPort.size.height * 0.5
			);
			this.nextPosition = newPoint;
		}
	}

	/// Walk to the next path cell or complete the path
	walkNext() {
		if (!this.walkPath || this.walkPath.length <= 0) {
			this.complete();
			return;
		}
		if (this.sprite.currentPosition === this.nextPosition) {
			this.walkPath.shift();
			this.updateWalkTo();
		}
	}
}
