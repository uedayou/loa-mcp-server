import type { DatasetProfile } from "./profile.js";
import type { EntityFeature } from "./entityFeature.js";
import { simplifyGeometry, countGeometryPoints, type SimplifyLevel } from "../geo/simplify.js";
import { roundGeometry, roundCoordinate, decimalPlacesFor } from "../geo/coordinatePrecision.js";

// 旧 src/lib/addressLod/featureNotes.ts を profile.notes 駆動に一般化。
// 「どの注記を出すか」はここで判断し、文言は profile.notes から取る(モデルB-mid)。

export function applySimplify(
  profile: DatasetProfile,
  feature: EntityFeature,
  level: SimplifyLevel | undefined
): { feature: EntityFeature; note: string | undefined } {
  if (!level || level === "none" || !feature.geometry) {
    return { feature, note: undefined };
  }
  const before = countGeometryPoints(feature.geometry);
  const simplifiedGeometry = simplifyGeometry(feature.geometry, level);
  const after = countGeometryPoints(simplifiedGeometry);
  return {
    feature: { ...feature, geometry: simplifiedGeometry },
    note: profile.notes.simplifyApplied(level, before, after),
  };
}

export function pointSourceNote(
  profile: DatasetProfile,
  feature: EntityFeature
): string | undefined {
  return feature.properties.point_source === "centroid" ? profile.notes.centroidPoint : undefined;
}

export function renderingHintNote(
  profile: DatasetProfile,
  feature: EntityFeature
): string | undefined {
  return feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon"
    ? profile.notes.renderingHint
    : undefined;
}

export function roundFeatureCoordinates(
  feature: EntityFeature,
  level: SimplifyLevel | undefined
): EntityFeature {
  const decimalPlaces = decimalPlacesFor(level);
  return {
    ...feature,
    geometry: feature.geometry ? roundGeometry(feature.geometry, decimalPlaces) : null,
    properties: {
      ...feature.properties,
      lat: roundCoordinate(feature.properties.lat, decimalPlaces),
      long: roundCoordinate(feature.properties.long, decimalPlaces),
    },
  };
}

export function finalizeFeature(
  profile: DatasetProfile,
  feature: EntityFeature,
  level: SimplifyLevel | undefined
): { feature: EntityFeature; notes: string[] } {
  const psNote = pointSourceNote(profile, feature);
  const { feature: simplifiedFeature, note: simplifyNote } = applySimplify(profile, feature, level);
  const renderNote = renderingHintNote(profile, simplifiedFeature);
  const notes = [psNote, simplifyNote, renderNote].filter((n): n is string => Boolean(n));
  return { feature: roundFeatureCoordinates(simplifiedFeature, level), notes };
}
