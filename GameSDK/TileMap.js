import Frame from "./Geometry/Frame.js";
import Point from "./Geometry/Point.js";
import Size from "./Geometry/Size.js";
import GridCoordinates from "./GridUtil/GridCoordinates.js";

/// Class used to represent a scrolling tile map
export default class TileMap {
	/// Initialize a new tile map
	///
	/// - Parameters:
	///		- canvas: The canvas to draw to
	///		- gridSize: The GridSize of the tile map
	/// 	- tileSize: The size of the tiles in the map
	constructor(canvas, gridSize, tileSize) {
		this.canvas = canvas;
		this.gridSize = gridSize;
		this.tileSize = tileSize;
		this.context = this.canvas.getContext("2d");
		this.context.imageSmoothingEnabled = false;
		this.viewPort = new Frame(
			new Point(0, 0),
			new Size(this.canvas.width, this.canvas.height)
		);

		let mapWidth = Math.ceil(gridSize.columns * this.tileSize);
		let mapHeight = Math.ceil(gridSize.rows * this.tileSize);
		this.maxX = mapWidth - this.viewPort.size.width;
		this.maxY = mapHeight - this.viewPort.size.height;
	}

	/// Method used to resize the tilemap
	///
	/// - Parameter canvas: The canvas to measure for resize
	resize(canvas) {
		this.canvas = canvas;
		this.context = this.canvas.getContext("2d");
		this.context.imageSmoothingEnabled = false;
		let currentPoint = this.viewPort.origin;
		this.viewPort = new Frame(
			currentPoint,
			new Size(this.canvas.width, this.canvas.height)
		);
	}

	/// Method used to trigger the load of the map
	loadMap() {}

	/// Override to make tiles unwalkable
	///
	/// - Parameter coordinates: The coordinates to check walkability for
	/// - Returns: True if the coordinates are walkable
	isWalkable(coordinates) {
		return true;
	}

	/// Method used to scroll to a given point in the tile map
	///
	/// - Parameters:
	/// 	- point: The point to scroll to
	///		- animated: Should the scroll be animated?
	scrollTo(point, animated) {
		let currentX = this.viewPort.origin.x;
		let currentY = this.viewPort.origin.y;
		let halfWidth = Math.floor(this.viewPort.size.width / 2);
		let halfHeight = Math.floor(this.viewPort.size.height / 2);
		var xMove = point.x - currentX - halfWidth;
		var yMove = point.y - currentY - halfHeight;

		if (animated) {
			xMove = xMove * 0.05;
			yMove = yMove * 0.05;
		}

		if (Math.abs(xMove) < 0.5) {
			xMove = 0;
		}
		if (Math.abs(yMove) < 0.5) {
			yMove = 0;
		}

		let newX = this.viewPort.origin.x + xMove;
		newX = Math.min(Math.max(0, newX), this.maxX);
		let newY = this.viewPort.origin.y + yMove;
		newY = Math.min(Math.max(0, newY), this.maxY);

		this.viewPort.origin = new Point(newX, newY);
	}

	/// Used to get the minimum visible column
	get minVisibleColumn() {
		var minColumn = Math.floor(this.viewPort.origin.x / this.tileSize);
		if (minColumn < 0) minColumn = 0;
		return minColumn;
	}

	/// Used to get the maxium visible column
	get maxVisibleColumn() {
		var maxColumn = Math.ceil(
			(this.viewPort.origin.x + this.viewPort.size.width) / this.tileSize
		);
		if (maxColumn > this.gridSize.columns)
			maxColumn = this.gridSize.columns;
		return maxColumn;
	}

	/// Used to get the minimum visible row
	get minVisibleRow() {
		var minRow = Math.floor(this.viewPort.origin.y / this.tileSize);
		if (minRow < 0) minRow = 0;
		return minRow;
	}

	/// Used to get the maxiumu visible row
	get maxVisibleRow() {
		var maxRow = Math.ceil(
			(this.viewPort.origin.y + this.viewPort.size.height) / this.tileSize
		);
		if (maxRow > this.gridSize.rows) maxRow = this.gridSize.rows;
		return maxRow;
	}

	/// Get the Point for a set of given GridCoordinates
	///
	/// - Parameter coordiantes: The coordinates to get the point for
	pointForCoordinates(coordiantes) {
		let xPos = Math.floor(
			coordiantes.column * this.tileSize -
				this.viewPort.origin.x +
				this.canvas.width / 2 -
				this.viewPort.size.width / 2
		);
		let yPos = Math.floor(
			coordiantes.row * this.tileSize -
				this.viewPort.origin.y +
				this.canvas.height / 2 -
				this.viewPort.size.height / 2
		);
		return new Point(xPos, yPos);
	}

	/// Get the Point for a set of given GridCoordinates
	/// This method uses world position and not viewport relative
	///
	/// - Parameter coordiantes: The coordinates to get the point for
	realPointForCoordinates(coordiantes) {
		let xPos = Math.floor(coordiantes.column * this.tileSize);
		let yPos = Math.floor(coordiantes.row * this.tileSize);
		return new Point(xPos, yPos);
	}

	/// Get the center Point for a set of given GridCoordinates
	///
	/// - Parameter coordiantes: The coordinates to get the point for
	centerPointForCoordinates(coordiantes) {
		const topLeftPoint = this.pointForCoordinates(coordiantes);
		const halfTile = Math.floor(this.tileSize / 2);
		return new Point(topLeftPoint.x + halfTile, topLeftPoint.y + halfTile);
	}

	/// Get the coordinates for a given point
	///
	/// - Parameter point: The point to get the coordinates for
	/// - Returns: The coordinates for the given point.
	coordinatesForPoint(point) {
		return new GridCoordinates(
			Math.floor(point.x / this.tileSize),
			Math.floor(point.y / this.tileSize)
		);
	}

	/// Render a given gridArray in the visible area
	///
	/// - Parameters:
	///		- gridArray: Layer data to use to render a layer
	///		- gridImage: The GridImage used as a tile sheet for the layer
	renderLayer(gridArray, gridImage) {
		let minColumn = this.minVisibleColumn;
		let maxColumn = this.maxVisibleColumn;
		let minRow = this.minVisibleRow;
		let maxRow = this.maxVisibleRow;
		for (let column = minColumn; column < maxColumn; column++) {
			for (let row = minRow; row < maxRow; row++) {
				const currentCoordinates = new GridCoordinates(column, row);
				const tileIndex = gridArray.getElementAt(currentCoordinates);
				const tileCoordinates =
					gridImage.tileGrid.coordinatesForIndex(tileIndex);
				const position = this.pointForCoordinates(currentCoordinates);
				const drawPoint = new Point(position.x, position.y);
				this.drawTile(
					gridImage,
					tileCoordinates,
					new Frame(drawPoint, new Size(this.tileSize, this.tileSize))
				);
			}
		}
	}

	/// Method to draw an individual tile
	///
	/// - Parameters:
	///		- gridImage: The GridImage for the tile sheet in this layer
	///		- tileCoordinates: The coordinates of the tile to draw
	///		- drawFrame: The frame in which to draw the tile.
	drawTile(gridImage, tileCoordinates, drawFrame) {
		this.context.drawImage(
			gridImage.image,
			tileCoordinates.column * this.tileSize,
			tileCoordinates.row * this.tileSize,
			this.tileSize,
			this.tileSize,
			drawFrame.origin.x,
			drawFrame.origin.y,
			drawFrame.size.width,
			drawFrame.size.height
		);
	}
}
