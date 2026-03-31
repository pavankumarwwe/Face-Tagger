import Foundation
import ImageIO
import Vision

let names = CommandLine.arguments.dropFirst()
guard !names.isEmpty else {
    fputs("Pass one or more image paths.\n", stderr)
    exit(1)
}

func analyze(url: URL) {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, [
            kCGImageSourceShouldCache: false
          ] as CFDictionary)
    else {
        print("\(url.lastPathComponent)|ERROR|load_failed")
        return
    }

    let faceRequest = VNDetectFaceLandmarksRequest()
    let textRequest = VNRecognizeTextRequest()
    textRequest.recognitionLevel = .fast
    textRequest.usesLanguageCorrection = false
    textRequest.minimumTextHeight = 0.02
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
        try handler.perform([faceRequest, textRequest])
    } catch {
        print("\(url.lastPathComponent)|ERROR|vision_failed")
        return
    }

    let faces = faceRequest.results ?? []
    let texts = textRequest.results ?? []

    guard let obs = faces.max(by: { a, b in
        a.boundingBox.width * a.boundingBox.height < b.boundingBox.width * b.boundingBox.height
    }) else {
        print("\(url.lastPathComponent)|NO_FACE|0|")
        return
    }

    let areaPct = obs.boundingBox.width * obs.boundingBox.height * 100.0
    let yaw = obs.yaw?.doubleValue
    let roll = obs.roll?.doubleValue
    let yawPenalty = min(abs(yaw ?? 0.0) / 0.8, 1.0)
    let rollPenalty = min(abs(roll ?? 0.0) / 0.6, 1.0)
    let frontalScore = max(0.0, 1.0 - ((yawPenalty * 0.7) + (rollPenalty * 0.3)))
    let prominentFaceCount = faces.filter { ($0.boundingBox.width * $0.boundingBox.height * 100.0) >= 4.0 }.count
    let visibleTextCount = texts.compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { $0.count >= 3 }
        .count
    let hasMultipleFaces = prominentFaceCount >= 2
    let hasPosterText = visibleTextCount >= 2
    let qualifies = areaPct >= 10.0 && frontalScore >= 0.60 && !hasMultipleFaces && !hasPosterText
    let yawText = yaw.map { String(format: "%.3f", $0) } ?? ""
    let rollText = roll.map { String(format: "%.3f", $0) } ?? ""
    let frontalText = String(format: "%.2f", frontalScore)
    let status = qualifies ? "PASS" : "FAIL"
    let reasons = [
        areaPct < 10.0 ? "small_face" : nil,
        frontalScore < 0.60 ? "non_frontal" : nil,
        hasMultipleFaces ? "multiple_faces" : nil,
        hasPosterText ? "poster_text" : nil
    ].compactMap { $0 }.joined(separator: ",")
    print("\(url.lastPathComponent)|\(status)|\(String(format: "%.2f", areaPct))|\(frontalText)|\(yawText)|\(rollText)|\(prominentFaceCount)|\(visibleTextCount)|\(reasons)")
}

for path in names {
    analyze(url: URL(fileURLWithPath: path))
}
