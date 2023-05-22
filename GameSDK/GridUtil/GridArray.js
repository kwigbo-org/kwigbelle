import GridCoordinates from "./GridCoordinates.js";

/// Class used to represent a two dimensional array
export default class GridArray {
    /// Initialize a GridArray with a `GridSize`
    ///
    /// - Parameter size: The size of the GridArray
    /// - Parameter generator: The function used to generate fill objects
    constructor(size, generator) {
        this.size = size;
        let total = this.size.columns * this.size.rows;
        this.elements = new Array(total);
        this.elements.fill(generator);
        Object.seal(this.elements);
    }

    /// Function to set coordinates for an index
    ///
    /// - Parameter index: The index to get the coordinates for
    /// - Returns: The GridCoordinates for the given index.
    coordinatesForIndex(index) {
        let realIndex = parseInt(index);
        let row = Math.floor(realIndex / this.size.columns);
        let column = Math.floor(realIndex % this.size.columns);
        return new GridCoordinates(column, row);
    }

    /// Get all neighbor coordinates for a given coordinates
    ///
    /// - Parameter coordinates: The coordinates to get neightbors for
    /// - Returns: An array of coordinates that are neighbors
    getNeighborCoordinatesForCoordinates(coordinates) {
        const column = coordinates.column;
        const row = coordinates.row;
        let neighbors = [];
        for (let c = column - 1; c <= column + 1; c++) {
            for (let r = row - 1; r <= row + 1; r++) {
                if (c != column || r != row) {
                    const coord = new GridCoordinates(c, r);
                    if (coord.isValidIn(this.size)) {
                        neighbors.push(coord);
                    }
                }
            }
        }
        return neighbors;
    }

    /// Get all neighbors for a given coordinates
    ///
    /// - Parameter coordinates: The coordinates to get neightbors for
    /// - Returns: An array of coordinates that are neighbors
    getNeighborsForCoordinates(coordinates) {
        const column = coordinates.column;
        const row = coordinates.row;
        let neighbors = [];
        for (let c = column - 1; c <= column + 1; c++) {
            for (let r = row - 1; r <= row + 1; r++) {
                if (c != column || r != row) {
                    const coord = new GridCoordinates(c, r);
                    if (coord.isValidIn(this.size)) {
                        neighbors.push(this.getElementAt(coord));
                    }
                }
            }
        }
        return neighbors;
    }

    /// Get all direct neighbors for a given coordinates (no diagonal)
    ///
    /// - Parameter coordinates: The coordinates to get neightbors for
    /// - Returns: An array of coordinates that are neighbors
    getDirectNeighborsForCoordinates(coordinates) {
        let neighbors = [];
        const top = new GridCoordinates(
            coordinates.column,
            coordinates.row - 1
        );
        if (top.isValidIn(this.size)) {
            neighbors.push(this.getElementAt(top));
        }
        const bottom = new GridCoordinates(
            coordinates.column,
            coordinates.row + 1
        );
        if (bottom.isValidIn(this.size)) {
            neighbors.push(this.getElementAt(bottom));
        }
        const left = new GridCoordinates(
            coordinates.column - 1,
            coordinates.row
        );
        if (left.isValidIn(this.size)) {
            neighbors.push(this.getElementAt(left));
        }
        const right = new GridCoordinates(
            coordinates.column + 1,
            coordinates.row
        );
        if (right.isValidIn(this.size)) {
            neighbors.push(this.getElementAt(right));
        }
        return neighbors;
    }

    /// Function to set the underlying array.
    ///
    /// - Parameter elements: The array of elements to set as the base for this structure
    overwriteElements(elements) {
        if (this.elements.length === elements.length) {
            this.elements = elements;
        } else {
            console.log(
                "Overwrite failed! Given elements length does not match."
            );
            console.log(this.elements.length);
            console.log(elements.length);
        }
    }

    /// Find random coordinates within the grid array
    ///
    /// - Returns: The random `GridCoordinates`
    randomCoordinates() {
        return GridCoordinates(
            getRandomInt(size.columns),
            getRandomInt(size.rows)
        );
    }

    /// Get an element at a specific `GridCoordinates`
    ///
    /// - Parameter coordinates: The `GridCoordinates` to get the element for
    ///
    /// - Returns: The element at the given `GridCoordinates`
    getElementAt(coordinates) {
        let realIndex =
            coordinates.row * this.size.columns + coordinates.column;
        return this.elements[realIndex];
    }

    /// Set an element at a specific `GridCoordinates`
    ///
    /// - Parameter element: The element to add the the grid array
    /// - Parameter coordinates: The `GridCoordinates` to sent the element for
    setElementAt(element, coordinates) {
        let realIndex =
            coordinates.row * this.size.columns + coordinates.column;
        this.elements[realIndex] = element;
    }

    /// Remove an element at a specified `GridCoordinates` from the grid array
    ///
    /// - Parameter coordinates: The `GridCoordinates` at which to remove an element
    removeElementAt(coordinates) {
        let realIndex =
            coordinates.row * this.size.columns + coordinates.column;
        this.elements[realIndex] = undefined;
    }

    /// Exchange the elements at two `GridCoordinates`
    ///
    /// - Parameter startCoordinates: The first coordinates to swap
    /// - Parameter endCoordinates: The sencond coordinates to swap
    exchangeElementAt(startCoordinates, withCoordinates) {
        let startIndex =
            startCoordinates.row * this.size.columns + startCoordinates.column;
        let endIndex =
            endCoordinates.row * this.size.columns + endCoordinates.column;
        swap(this.elements, this.elements[startIndex], this.elements[endIndex]);
    }
}
