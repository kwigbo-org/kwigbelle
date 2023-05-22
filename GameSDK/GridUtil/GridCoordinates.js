import Direction from "../Direction.js";

/// Class used to represent a position in a grid
export default class GridCoordinates {
    /// Zero coordinate
    static zero = new GridCoordinates(0, 0);

    /// Create a new `GridCoordinates`
    ///
    /// - Parameter column: The column for the coordinates
    /// - Parameter row: The row for the coordinates
    constructor(column, row) {
        this.column = column;
        this.row = row;
    }

    /// The manhattan distance between two `GridCoordinates`
    ///
    /// - Parameter startCoordinates: The `GridCoordinates` to start measuring from
    /// - Parameter endCoordinates: The `GridCoordinates` to end measuring at
    ///
    /// - Returns: The distance between the two coordinates
    static manhattanDistance(startCoordinates, endCoordinates) {
        const xDist = Math.abs(startCoordinates.column - endCoordinates.column);
        const yDist = Math.abs(startCoordinates.row - endCoordinates.row);
        if (xDist > yDist) {
            return 14 * yDist + 10 * (xDist - yDist);
        }
        return 14 * xDist + 10 * (yDist - xDist);
    }

    /// Get the manhattan distance to another `GridCoordinates`
    ///
    /// - Parameter coordinates: The coordinates to get the distance to
    /// - Returns: The manhattan distance between the coordinates
    distanceTo(coordinates) {
        return GridCoordinates.manhattanDistance(this, coordinates);
    }

    /// Are the coordinates valid within a given `GridSize`
    ///
    /// - Parameter gridSize: The GridSize to test for validity in
    isValidIn(gridSize) {
        return (
            this.column >= 0 &&
            this.column < gridSize.columns &&
            this.row >= 0 &&
            this.row < gridSize.rows
        );
    }

    /// Get the direction to the next coordinates
    ///
    /// - Parameter coordinates: The coordinates to get the direction to.
    directionTo(coordinates) {
        if (coordinates) {
            if (coordinates.row < this.row) {
                return Direction.Up;
            }
            if (coordinates.row > this.row) {
                return Direction.Down;
            }
            if (coordinates.column > this.column) {
                return Direction.Right;
            }
            if (coordinates.column < this.column) {
                return Direction.Left;
            }
        }
        return Direction.Down;
    }

    /// Step the `GridCoordinates` in a specific `GridCoordinates`
    ///
    /// - Parameter direction: The direction to step the coordinates in
    ///
    /// - Returns: The `GridCoordinates` of the movement
    stepIn(direction) {
        switch (direction) {
            case Direction.Up:
                return new GridCoordinates(this.column, this.row + 1);
            case Direction.Down:
                return new GridCoordinates(this.column, this.row - 1);
            case Direction.Left:
                return new GridCoordinates(this.column - 1, this.row);
            case Direction.Right:
                return new GridCoordinates(this.column + 1, this.row);
        }
    }

    /// Check if another GridCoordinates is the same as the current
    ///
    /// - Parameter coordinates: The GridCoordinates to test equality with
    /// - Returns: True if the GridCoordinates are the same.
    isEqual(coordinates) {
        return (
            this.column === coordinates.column && this.row === coordinates.row
        );
    }
}
