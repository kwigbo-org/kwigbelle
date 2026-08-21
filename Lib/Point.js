/// Class used to define a point
export default class Point {
  /// Create a new point object
  ///
  /// - Parameters:
  ///   - x: The x position of the point
  ///   - y: The y position of the point
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  /// Calculate the distance from the current point to another
  ///
  /// - Parameter point: The point to get the distance to
  /// - Returns: The distance between the two points
  distanceTo(point) {
    var a = this.x - point.x;
    var b = this.y - point.y;
    return Math.sqrt(a * a + b * b);
  }
}
