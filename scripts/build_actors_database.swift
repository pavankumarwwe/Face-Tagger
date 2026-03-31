import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

struct Config {
    static let maxBytes = 15 * 1024
    static let outputPixels = 144
    static let processingMaxPixels = 1200
    static let cropExpansion: CGFloat = 2.05
    static let verticalBias: CGFloat = -0.12
}

let fm = FileManager.default
let root = URL(fileURLWithPath: fm.currentDirectoryPath)
let sourceDir = root.appendingPathComponent("Actors Faces", isDirectory: true)
let outputDir = root.appendingPathComponent("Actors Database", isDirectory: true)

guard let sourceItems = try? fm.contentsOfDirectory(
    at: sourceDir,
    includingPropertiesForKeys: [.isRegularFileKey],
    options: [.skipsHiddenFiles]
) else {
    fputs("Unable to read Actors Faces directory\n", stderr)
    exit(1)
}

try? fm.createDirectory(at: outputDir, withIntermediateDirectories: true)
if let existingOutputs = try? fm.contentsOfDirectory(
    at: outputDir,
    includingPropertiesForKeys: nil,
    options: [.skipsHiddenFiles]
) {
    for existing in existingOutputs {
        try? fm.removeItem(at: existing)
    }
}

func loadImage(at url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateThumbnailAtIndex(src, 0, [
        kCGImageSourceShouldCache: false,
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: Config.processingMaxPixels
    ] as CFDictionary)
}

func detectPrimaryFace(in image: CGImage) -> CGRect? {
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return nil
    }

    let observations = request.results ?? []
    guard !observations.isEmpty else {
        return nil
    }

    let best = observations.max { lhs, rhs in
        lhs.boundingBox.width * lhs.boundingBox.height < rhs.boundingBox.width * rhs.boundingBox.height
    }
    guard let box = best?.boundingBox else { return nil }

    let imageRect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let visionRect = VNImageRectForNormalizedRect(box, image.width, image.height)
    let converted = CGRect(
        x: visionRect.origin.x,
        y: imageRect.height - visionRect.origin.y - visionRect.height,
        width: visionRect.width,
        height: visionRect.height
    )
    return converted.intersection(imageRect)
}

func centeredSquare(in rect: CGRect, image: CGImage) -> CGRect {
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    let side = min(width, height)
    return CGRect(
        x: max(0, (width - side) / 2),
        y: max(0, (height - side) / 2),
        width: side,
        height: side
    ).integral
}

func cropRect(for image: CGImage, faceRect: CGRect?) -> CGRect {
    let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    guard let faceRect else {
        return centeredSquare(in: imageBounds, image: image)
    }

    let expandedSide = min(
        max(faceRect.width, faceRect.height) * Config.cropExpansion,
        min(imageBounds.width, imageBounds.height)
    )

    let centerX = faceRect.midX
    let centerY = faceRect.midY + (faceRect.height * Config.verticalBias)

    var crop = CGRect(
        x: centerX - expandedSide / 2,
        y: centerY - expandedSide / 2,
        width: expandedSide,
        height: expandedSide
    )

    if crop.minX < 0 { crop.origin.x = 0 }
    if crop.minY < 0 { crop.origin.y = 0 }
    if crop.maxX > imageBounds.width { crop.origin.x = imageBounds.width - crop.width }
    if crop.maxY > imageBounds.height { crop.origin.y = imageBounds.height - crop.height }

    return crop.intersection(imageBounds).integral
}

func resize(_ image: CGImage, to pixels: Int) -> CGImage? {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil,
        width: pixels,
        height: pixels,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return nil
    }

    context.interpolationQuality = .high
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    context.draw(image, in: CGRect(x: 0, y: 0, width: pixels, height: pixels))
    return context.makeImage()
}

func jpegData(from image: CGImage, quality: CGFloat) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
        return nil
    }

    let options: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: quality,
        kCGImagePropertyOrientation: 1
    ]
    CGImageDestinationAddImage(dest, image, options as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
}

func encodedAvatarData(from image: CGImage) -> Data? {
    var best: Data?
    for pixels in stride(from: Config.outputPixels, through: 88, by: -8) {
        guard let resized = resize(image, to: pixels) else { continue }
        for q in stride(from: 0.82, through: 0.28, by: -0.06) {
            guard let data = jpegData(from: resized, quality: CGFloat(q)) else { continue }
            if data.count <= Config.maxBytes {
                return data
            }
            if best == nil || data.count < best!.count {
                best = data
            }
        }
    }
    return best
}

var usedNames = Set<String>()
var created = 0
var faceDetected = 0
var fallbacks = [String]()
var oversized = [String]()
var failures = [String]()

let allowed = Set(["jpg", "jpeg", "png", "webp"])

for source in sourceItems.sorted(by: { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }) {
    let ext = source.pathExtension.lowercased()
    guard allowed.contains(ext) else { continue }
    guard let image = loadImage(at: source) else {
        failures.append(source.lastPathComponent)
        continue
    }

    let face = detectPrimaryFace(in: image)
    if face != nil { faceDetected += 1 } else { fallbacks.append(source.lastPathComponent) }

    let crop = cropRect(for: image, faceRect: face)
    guard let cropped = image.cropping(to: crop), let data = encodedAvatarData(from: cropped) else {
        failures.append(source.lastPathComponent)
        continue
    }

    let baseName = source.deletingPathExtension().lastPathComponent
    var outputName = "\(baseName).jpg"
    if usedNames.contains(outputName.lowercased()) {
        outputName = "\(baseName)__\(ext).jpg"
    }
    usedNames.insert(outputName.lowercased())

    let destination = outputDir.appendingPathComponent(outputName)
    do {
        try data.write(to: destination, options: .atomic)
        if data.count > Config.maxBytes {
            oversized.append(outputName)
        }
        created += 1
    } catch {
        failures.append(source.lastPathComponent)
    }
}

print("Created \(created) files in Actors Database")
print("Face-detected crops: \(faceDetected)")
print("Fallback center crops: \(fallbacks.count)")
print("Oversized outputs: \(oversized.count)")
print("Failures: \(failures.count)")

if !fallbacks.isEmpty {
    print("Fallback files:")
    for name in fallbacks.prefix(40) {
        print(name)
    }
    if fallbacks.count > 40 {
        print("... and \(fallbacks.count - 40) more")
    }
}

if !oversized.isEmpty {
    print("Oversized files:")
    for name in oversized {
        print(name)
    }
}

if !failures.isEmpty {
    print("Failed files:")
    for name in failures {
        print(name)
    }
}
