// Class to define possible movement directions
export default class Direction {
    static Down = new Direction(0);
    static Up = new Direction(1);
    static Left = new Direction(2);
    static Right = new Direction(3);

    /// Initialize a direction with a raw value
    ///
    /// - Parameter rawValue: The int value for the direction
    constructor(rawValue) {
        this.rawValue = rawValue;
    }

    // Get the direction opposite the given direction
    ///
    /// - Parameter direction: The direction to get the opposite of
    /// - Returns: The opposite of the given direction
    static opposite(direction) {
        switch (direction) {
            case Direction.Up:
                return Direction.Down;
            case Direction.Down:
                return Direction.Up;
            case Direction.Left:
                return Direction.Right;
            case Direction.Right:
                return Direction.Left;
        }
    }
}
