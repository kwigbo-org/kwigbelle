/// Object used to define a frame
export default class Frame {
  /// Initialize a new frmae with an origin point and size
  ///
  /// - Parameters:
  ///   - origin: The x and y values for the frame
  ///   - size: The width and height for the frame
  constructor(origin, size) {
    this.origin = origin;
    this.size = size;
  }

  /// Test if another frame is equal to the current frame
  ///
  /// - Parameter frame: The frame to check for equality with
  /// - Returns: True if the frames are equal
  isEqual(frame) {
    let valuesEqual =
      this.origin.x === frame.origin.x &&
      this.origin.y === frame.origin.y &&
      this.size.width === frame.size.width &&
      this.size.height === frame.size.height;
    return valuesEqual;
  }

  /// Test if one frame has collided with another
  ///
  /// - Parameter frame: The frame to check for collision with
  /// - Returns: True if the frames are colliding
  collided(frame) {
    let check1 = this.origin.x < frame.origin.x + frame.size.width;
    let check2 = this.origin.x + this.size.width > frame.origin.x;
    let check3 = this.origin.y < frame.origin.y + frame.size.height;
    let check4 = this.origin.y + this.size.height > frame.origin.y;
    return check1 && check2 && check3 && check4;
  }

  /// Test if a circle confined to the current frame collides with another
  /// Converts the frame to a circle using the width to get the radius
  ///
  /// - Parameter frame: The frame to check for collision with
  /// - Returns: True if the circles are colliding
  circleCollision(frame) {
    let radius = this.size.width / 2;
    let centerX = this.origin.x + radius;
    let centerY = this.origin.y + radius;

    let frameRadius = frame.size.width / 2;
    let frameCenterX = frame.origin.x + frameRadius;
    let frameCenterY = frame.origin.y + frameRadius;

    var a = centerX - frameCenterX;
    var b = centerY - frameCenterY;
    var distance = Math.abs(Math.sqrt(a * a + b * b));
    let tollerance = 6;

    return distance <= radius + frameRadius - tollerance;
  }
}
