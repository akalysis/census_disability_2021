const data = window.DISABILITY_MAP_DATA;

if (!data || !window.maplibregl) {
  throw new Error("Map dependencies did not load.");
}

const MODE_CONFIG = {
  gap: {
    label: "Gap vs England",
    legendTitle: "Percentage-point gap from the England average",
    heightTitle: "3D height",
    heightBody: "Taller forms show a larger departure from the England average at the selected geography.",
  },
  prevalence: {
    label: "Prevalence",
    legendTitle: "Disabled residents as a share of the selected population",
    heightTitle: "3D height",
    heightBody: "Taller forms show higher disability prevalence in the selected age groups.",
  },
};

const GEOGRAPHY_CONFIG = {
  lad: {
    label: "Local authority",
    noun: "local authority",
    plural: "local authorities",
    shortLabel: "LA",
    activeLayer: "lad-extrusions",
    summary:
      "This is the clearest national starting point: broad enough to read, but detailed enough to show real inequality.",
    focusMaxZoom: 9.1,
  },
  region: {
    label: "Region",
    noun: "region",
    plural: "regions",
    shortLabel: "GOR",
    activeLayer: "region-extrusions",
    summary:
      "Use regions for the headline GOR story and the broadest north-south and urban-rural differences.",
    focusMaxZoom: 7.9,
  },
  msoa: {
    label: "MSOA",
    noun: "MSOA",
    plural: "MSOAs",
    shortLabel: "MSOA",
    activeLayer: "msoa-extrusions",
    summary:
      "Switch to MSOAs for finer local texture once you want to see which neighbourhoods drive the wider pattern.",
    focusMaxZoom: 11.1,
  },
};

const PRESETS = {
  all: data.ageBands.map((_, index) => index),
  working: [2, 3, 4, 5, 6, 7, 8],
  older: [9, 10, 11],
};

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const DEFAULT_VIEW = {
  center: [-2.45, 53.35],
  zoom: 5.78,
  pitch: 54,
  bearing: 0,
};

const HEIGHT_LIMITS = {
  msoa: { prevalence: 2400, gap: 2800, min: 40 },
  lad: { prevalence: 5600, gap: 6200, min: 120 },
  region: { prevalence: 8400, gap: 9600, min: 400 },
};

const LAYER_GROUPS = {
  msoa: ["msoa-footprint", "msoa-extrusions", "msoa-outline"],
  lad: ["lad-footprint", "lad-extrusions", "lad-outline"],
  region: ["region-footprint", "region-extrusions"],
};

const state = {
  selectedAgeIndices: new Set(PRESETS.all),
  mode: "gap",
  geography: "lad",
  hoveredCode: null,
  selectedCode: null,
  hoveredRegionCode: null,
  userInteracted: false,
  storyActive: false,
  storyHasAutoStarted: false,
  storyKicker: "Story mode",
  storyTitle: "Massive inequality across England",
  storyBody: "The opening tour will move region to region until you take control.",
  storyStepIndex: 0,
  storyStepCount: 0,
  englandMetric: null,
  metricsByGeography: {
    msoa: new Map(),
    lad: new Map(),
    region: new Map(),
  },
  sortedMetricsByGeography: {
    msoa: [],
    lad: [],
    region: [],
  },
  extremesByGeography: {
    msoa: null,
    lad: null,
    region: null,
  },
  regionExtremesByGeography: {
    msoa: new Map(),
    lad: new Map(),
  },
};

const dom = {
  geographySwitch: document.querySelector("#geography-switch"),
  geographySummary: document.querySelector("#geography-summary"),
  modeSwitch: document.querySelector("#mode-switch"),
  ageChips: document.querySelector("#age-chips"),
  ageSummary: document.querySelector("#age-summary"),
  mapTitle: document.querySelector("#map-title"),
  mapSubtitle: document.querySelector("#map-subtitle"),
  legend: document.querySelector("#legend"),
  heightNote: document.querySelector("#height-note"),
  mapReadoutLabel: document.querySelector("#map-readout-label"),
  mapReadoutName: document.querySelector("#map-readout-name"),
  mapReadoutRegion: document.querySelector("#map-readout-region"),
  mapReadoutRate: document.querySelector("#map-readout-rate"),
  mapReadoutGap: document.querySelector("#map-readout-gap"),
  mapReadoutDisabled: document.querySelector("#map-readout-disabled"),
  mapReadoutTotal: document.querySelector("#map-readout-total"),
  storyPanel: document.querySelector("#story-panel"),
  storyKicker: document.querySelector("#story-kicker"),
  storyTitle: document.querySelector("#story-title"),
  storyBody: document.querySelector("#story-body"),
  storyProgress: document.querySelector("#story-progress"),
  storyToggle: document.querySelector("#story-toggle"),
  rotateLeft: document.querySelector("#rotate-left"),
  rotateRight: document.querySelector("#rotate-right"),
  focusName: document.querySelector("#focus-name"),
  focusContext: document.querySelector("#focus-context"),
  focusRate: document.querySelector("#focus-rate"),
  focusGap: document.querySelector("#focus-gap"),
  focusDisabled: document.querySelector("#focus-disabled"),
  focusTotal: document.querySelector("#focus-total"),
  highestGeoLabel: document.querySelector("#highest-geo-label"),
  highestRegionName: document.querySelector("#highest-region-name"),
  highestRegionRate: document.querySelector("#highest-region-rate"),
  lowestGeoLabel: document.querySelector("#lowest-geo-label"),
  lowestRegionName: document.querySelector("#lowest-region-name"),
  lowestRegionRate: document.querySelector("#lowest-region-rate"),
  geoGapLabel: document.querySelector("#geo-gap-label"),
  geoGapNote: document.querySelector("#geo-gap-note"),
  regionalContextLabel: document.querySelector("#regional-context-label"),
  regionalGap: document.querySelector("#regional-gap"),
  localExtremes: document.querySelector("#local-extremes"),
  localExtremesNote: document.querySelector("#local-extremes-note"),
  rankingLabel: document.querySelector("#ranking-label"),
  rankingTitle: document.querySelector("#ranking-title"),
  regionList: document.querySelector("#region-list"),
  fullscreenMap: document.querySelector("#fullscreen-map"),
  resetView: document.querySelector("#reset-view"),
  presetButtons: Array.from(document.querySelectorAll(".preset-button")),
};

function boundsFromGeometry(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      minX = Math.min(minX, coordinates[0]);
      minY = Math.min(minY, coordinates[1]);
      maxX = Math.max(maxX, coordinates[0]);
      maxY = Math.max(maxY, coordinates[1]);
      return;
    }
    coordinates.forEach(visit);
  };

  visit(geometry.coordinates);
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function boundsFromGeometryCollection(features) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  features.forEach((feature) => {
    const bounds = boundsFromGeometry(feature.geometry);
    minX = Math.min(minX, bounds[0][0]);
    minY = Math.min(minY, bounds[0][1]);
    maxX = Math.max(maxX, bounds[1][0]);
    maxY = Math.max(maxY, bounds[1][1]);
  });

  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function centreOfBounds(bounds) {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

function normaliseBoundaryFeature(feature, geography) {
  if (geography === "msoa") {
    return {
      code: feature.properties.c,
      name: feature.properties.n,
      regionName: feature.properties.r,
      regionCode: feature.properties.rc,
      localAuthorityName: feature.properties.la,
      localAuthorityCode: feature.properties.lac,
    };
  }

  if (geography === "lad") {
    return {
      code: feature.properties.code,
      name: feature.properties.name,
      regionName: feature.properties.r,
      regionCode: feature.properties.rc,
      localAuthorityName: feature.properties.name,
      localAuthorityCode: feature.properties.code,
    };
  }

  return {
    code: feature.properties.code,
    name: feature.properties.name,
    regionName: "England",
    regionCode: "ENG",
    localAuthorityName: null,
    localAuthorityCode: null,
  };
}

function buildRuntimeCollection(features, geography) {
  return {
    type: "FeatureCollection",
    features: features.map((feature) => {
      const props = normaliseBoundaryFeature(feature, geography);
      return {
        type: "Feature",
        id: props.code,
        geometry: feature.geometry,
        properties: {
          ...props,
          fill: "#c9e9ed",
          height: 0,
          rateValue: null,
          gapValue: null,
          renderValue: null,
        },
      };
    }),
  };
}

const runtimeCollections = {
  msoa: buildRuntimeCollection(data.msoas.features, "msoa"),
  lad: buildRuntimeCollection(data.localAuthorityBoundaries.features, "lad"),
  region: buildRuntimeCollection(data.regionBoundaries.features, "region"),
};

const runtimeFeatureByGeography = {
  msoa: new Map(runtimeCollections.msoa.features.map((feature) => [feature.properties.code, feature])),
  lad: new Map(runtimeCollections.lad.features.map((feature) => [feature.properties.code, feature])),
  region: new Map(runtimeCollections.region.features.map((feature) => [feature.properties.code, feature])),
};

const boundsByGeography = {
  msoa: new Map(data.msoas.features.map((feature) => [feature.properties.c, boundsFromGeometry(feature.geometry)])),
  lad: new Map(
    data.localAuthorityBoundaries.features.map((feature) => [feature.properties.code, boundsFromGeometry(feature.geometry)])
  ),
  region: new Map(
    data.regionBoundaries.features.map((feature) => [feature.properties.code, boundsFromGeometry(feature.geometry)])
  ),
};

const regionLabelByCode = new Map(
  (data.regionLabels?.features || []).map((feature) => [feature.properties.code, feature])
);
const englandBounds = boundsFromGeometryCollection(data.regionBoundaries.features);

let mapView = null;
try {
  mapView = new maplibregl.Map({
    container: "map",
    antialias: true,
    dragRotate: false,
    pitchWithRotate: false,
    minZoom: 4.7,
    maxZoom: 13,
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: DEFAULT_VIEW.pitch,
    bearing: DEFAULT_VIEW.bearing,
    style: {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          tiles: [
            "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
            "https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
          ],
        },
      },
      layers: [{ id: "carto-base", type: "raster", source: "carto" }],
    },
  });
} catch (error) {
  console.error("Unable to initialise the 3D map.", error);
}

let mapLoaded = false;
let popup = null;
let storyTimer = null;
let storyStartTimer = null;
let storyRunId = 0;
let storyIdleListenerArmed = false;

function heightExpression(lowZoom, lowFactor, midZoom, midFactor, highZoom, highFactor) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    lowZoom,
    ["*", ["coalesce", ["get", "height"], 0], lowFactor],
    midZoom,
    ["*", ["coalesce", ["get", "height"], 0], midFactor],
    highZoom,
    ["*", ["coalesce", ["get", "height"], 0], highFactor],
  ];
}

if (mapView) {
  mapView.on("load", () => {
    mapLoaded = true;

    mapView.addSource("msoas", { type: "geojson", data: runtimeCollections.msoa });
    mapView.addSource("lads", { type: "geojson", data: runtimeCollections.lad });
    mapView.addSource("regions", { type: "geojson", data: runtimeCollections.region });
    mapView.addSource("hover-feature", { type: "geojson", data: EMPTY_COLLECTION });
    mapView.addSource("selection-feature", { type: "geojson", data: EMPTY_COLLECTION });
    mapView.addSource("region-hover-feature", { type: "geojson", data: EMPTY_COLLECTION });

    mapView.addLayer({
      id: "region-footprint",
      type: "fill",
      source: "regions",
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": 0.62,
      },
    });

    mapView.addLayer({
      id: "region-extrusions",
      type: "fill-extrusion",
      source: "regions",
      paint: {
        "fill-extrusion-color": ["get", "fill"],
        "fill-extrusion-height": heightExpression(4.7, 0.42, 6.2, 0.72, 8.2, 1),
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4.7,
          0.72,
          6.4,
          0.88,
          8.2,
          0.94,
        ],
        "fill-extrusion-vertical-gradient": true,
      },
    });

    mapView.addLayer({
      id: "lad-footprint",
      type: "fill",
      source: "lads",
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4.8,
          0.46,
          6.2,
          0.58,
          8.8,
          0.74,
        ],
      },
    });

    mapView.addLayer({
      id: "lad-extrusions",
      type: "fill-extrusion",
      source: "lads",
      paint: {
        "fill-extrusion-color": ["get", "fill"],
        "fill-extrusion-height": heightExpression(4.8, 0.34, 6.6, 0.72, 9.5, 1),
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4.8,
          0.56,
          6.8,
          0.82,
          9.6,
          0.96,
        ],
        "fill-extrusion-vertical-gradient": true,
      },
    });

    mapView.addLayer({
      id: "lad-outline",
      type: "line",
      source: "lads",
      minzoom: 6.2,
      paint: {
        "line-color": "#f4fdff",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6.2,
          0.2,
          8.5,
          0.5,
          11,
          0.85,
        ],
        "line-opacity": 0.22,
      },
    });

    mapView.addLayer({
      id: "msoa-footprint",
      type: "fill",
      source: "msoas",
      minzoom: 4.95,
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4.95,
          0.12,
          6.2,
          0.28,
          7.5,
          0.54,
          10.5,
          0.76,
        ],
      },
    });

    mapView.addLayer({
      id: "msoa-extrusions",
      type: "fill-extrusion",
      source: "msoas",
      minzoom: 5.2,
      paint: {
        "fill-extrusion-color": ["get", "fill"],
        "fill-extrusion-height": heightExpression(5.2, 0.2, 7.2, 0.68, 10.8, 1),
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5.2,
          0.34,
          7.4,
          0.76,
          10.8,
          0.96,
        ],
        "fill-extrusion-vertical-gradient": true,
      },
    });

    mapView.addLayer({
      id: "msoa-outline",
      type: "line",
      source: "msoas",
      minzoom: 7.4,
      paint: {
        "line-color": "#f4fdff",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          7.4,
          0.08,
          8.4,
          0.28,
          11.4,
          0.58,
        ],
        "line-opacity": 0.18,
      },
    });

    mapView.addLayer({
      id: "hover-outline",
      type: "line",
      source: "hover-feature",
      paint: {
        "line-color": "#f7feff",
        "line-width": 2.4,
        "line-opacity": 0.95,
      },
    });

    mapView.addLayer({
      id: "selection-outline",
      type: "line",
      source: "selection-feature",
      paint: {
        "line-color": "#0d6f73",
        "line-width": 3,
        "line-opacity": 0.95,
      },
    });

    mapView.addLayer({
      id: "region-hover-outline",
      type: "line",
      source: "region-hover-feature",
      paint: {
        "line-color": "#f8feff",
        "line-width": 2.8,
        "line-opacity": 0.96,
      },
    });

    attachMapInteractions();
    update();
    fitBoundsWithAngle(englandBounds, {
      padding: { top: 56, right: 56, bottom: 56, left: 56 },
      maxZoom: DEFAULT_VIEW.zoom,
      duration: 0,
    });
    queueInitialStoryStart();
  });
}

function sumIndices(values, indices) {
  return indices.reduce((total, index) => total + values[index], 0);
}

function summariseArrays(disabledValues, totalValues, indices) {
  const disabled = sumIndices(disabledValues, indices);
  const total = sumIndices(totalValues, indices);
  const rate = total > 0 ? disabled / total : null;
  return { disabled, total, rate };
}

function formatPercent(value, decimals = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : "n/a";
}

function formatPp(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(decimals)} pp`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) {
    return 0;
  }
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function uniqueAscending(values) {
  return values
    .sort((left, right) => left - right)
    .filter((value, index, array) => index === 0 || value > array[index - 1] + 1e-9)
    .map((value) => Number(value.toFixed(6)));
}

function buildPrevalenceScale(values, geography) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const thresholds = uniqueAscending([
    quantile(sorted, 0.15),
    quantile(sorted, 0.35),
    quantile(sorted, 0.55),
    quantile(sorted, 0.75),
    quantile(sorted, 0.9),
  ]);
  const colors = ["#eefbfc", "#cdeff2", "#8fd9df", "#46afbf", "#176f8c", "#0a3552"];
  const maxRate = sorted[sorted.length - 1] || 0.25;
  const { prevalence: maxHeight, min: minHeight } = HEIGHT_LIMITS[geography];

  return {
    colors,
    colorFor(value) {
      if (!Number.isFinite(value)) {
        return "#d6dde0";
      }
      const index = thresholds.findIndex((threshold) => value <= threshold);
      return colors[index === -1 ? colors.length - 1 : index];
    },
    heightFor(metric) {
      if (!Number.isFinite(metric.rate)) {
        return 0;
      }
      const normalised = maxRate > 0 ? metric.rate / maxRate : 0;
      return minHeight + normalised * (maxHeight - minHeight);
    },
    lowLabel: formatPercent(sorted[0] || 0),
    highLabel: formatPercent(sorted[sorted.length - 1] || 0),
  };
}

function buildGapScale(values, geography) {
  const absolute = values
    .filter(Number.isFinite)
    .map((value) => Math.abs(value))
    .sort((left, right) => left - right);

  const t1 = Math.max(quantile(absolute, 0.45), 0.002);
  const t2 = Math.max(quantile(absolute, 0.7), t1 + 0.0015);
  const t3 = Math.max(quantile(absolute, 0.9), t2 + 0.0015);
  const maxAbs = absolute[absolute.length - 1] || t3 || 0.01;
  const { gap: maxHeight, min: minHeight } = HEIGHT_LIMITS[geography];
  const colors = ["#0a4069", "#2c739f", "#8dc5d6", "#f6f5ee", "#ffc5aa", "#ff8d74", "#d6495f"];

  return {
    colors,
    colorFor(value) {
      if (!Number.isFinite(value)) {
        return "#d6dde0";
      }
      if (value <= -t3) {
        return colors[0];
      }
      if (value <= -t2) {
        return colors[1];
      }
      if (value <= -t1) {
        return colors[2];
      }
      if (value < t1) {
        return colors[3];
      }
      if (value < t2) {
        return colors[4];
      }
      if (value < t3) {
        return colors[5];
      }
      return colors[6];
    },
    heightFor(metric) {
      if (!Number.isFinite(metric.gap)) {
        return 0;
      }
      const normalised = maxAbs > 0 ? Math.abs(metric.gap) / maxAbs : 0;
      return minHeight + normalised * (maxHeight - minHeight);
    },
    lowLabel: formatPp(-(t3 || 0)),
    highLabel: formatPp(t3 || 0),
  };
}

function getSelectedIndices() {
  return Array.from(state.selectedAgeIndices).sort((left, right) => left - right);
}

function sameSelection(indices, comparison) {
  if (indices.length !== comparison.length) {
    return false;
  }
  return indices.every((value, index) => value === comparison[index]);
}

function getAgeSummary(indices) {
  if (sameSelection(indices, PRESETS.all)) {
    return "All 12 age groups are included.";
  }
  if (sameSelection(indices, PRESETS.working)) {
    return "Working-age adults (15 to 64) are selected.";
  }
  if (sameSelection(indices, PRESETS.older)) {
    return "Older residents aged 65 and over are selected.";
  }
  if (indices.length === 1) {
    return `One age group selected: ${data.ageBands[indices[0]].label}.`;
  }
  const labels = indices.map((index) => data.ageBands[index].shortLabel);
  const suffix =
    labels.length <= 5 ? labels.join(", ") : `${labels.slice(0, 5).join(", ")} +${labels.length - 5} more`;
  return `${indices.length} age groups selected: ${suffix}.`;
}

function getLensTitle(indices) {
  if (sameSelection(indices, PRESETS.all)) {
    return "All age groups";
  }
  if (sameSelection(indices, PRESETS.working)) {
    return "Working age (15 to 64)";
  }
  if (sameSelection(indices, PRESETS.older)) {
    return "Older ages (65+)";
  }
  if (indices.length === 1) {
    return data.ageBands[indices[0]].label;
  }
  return `${indices.length} selected age groups`;
}

function buildMetricRecord(geography, source, selectedIndices, englandMetric) {
  const metric = summariseArrays(source.disabled, source.total, selectedIndices);
  return {
    geography,
    code: source.code,
    name: source.name,
    regionName: source.regionName || "England",
    regionCode: source.regionCode || "ENG",
    localAuthorityName: source.localAuthorityName || null,
    localAuthorityCode: source.localAuthorityCode || null,
    disabled: metric.disabled,
    total: metric.total,
    rate: metric.rate,
    gap: Number.isFinite(metric.rate) ? metric.rate - englandMetric.rate : null,
  };
}

function computeRegionExtremes(metrics) {
  const grouped = new Map();

  metrics.forEach((metric) => {
    if (!Number.isFinite(metric.rate) || !metric.regionCode || metric.regionCode === "ENG") {
      return;
    }

    const record = grouped.get(metric.regionCode) || { highest: null, lowest: null };
    if (!record.highest || metric.rate > record.highest.rate) {
      record.highest = metric;
    }
    if (!record.lowest || metric.rate < record.lowest.rate) {
      record.lowest = metric;
    }
    grouped.set(metric.regionCode, record);
  });

  return grouped;
}

function computeMetrics() {
  const selectedIndices = getSelectedIndices();
  const englandMetric = summariseArrays(data.england.disabled, data.england.total, selectedIndices);

  const msoaMetrics = data.msoas.features
    .map((feature) =>
      buildMetricRecord(
        "msoa",
        {
          code: feature.properties.c,
          name: feature.properties.n,
          regionName: feature.properties.r,
          regionCode: feature.properties.rc,
          localAuthorityName: feature.properties.la,
          localAuthorityCode: feature.properties.lac,
          disabled: feature.properties.d,
          total: feature.properties.t,
        },
        selectedIndices,
        englandMetric
      )
    )
    .sort((left, right) => right.rate - left.rate);

  const ladMetrics = data.localAuthorities
    .map((localAuthority) =>
      buildMetricRecord(
        "lad",
        {
          code: localAuthority.code,
          name: localAuthority.name,
          regionName: localAuthority.regionName,
          regionCode: localAuthority.regionCode,
          localAuthorityName: localAuthority.name,
          localAuthorityCode: localAuthority.code,
          disabled: localAuthority.disabled,
          total: localAuthority.total,
        },
        selectedIndices,
        englandMetric
      )
    )
    .sort((left, right) => right.rate - left.rate);

  const regionMetrics = data.regions
    .map((region) =>
      buildMetricRecord(
        "region",
        {
          code: region.code,
          name: region.name,
          regionName: "England",
          regionCode: "ENG",
          localAuthorityName: null,
          localAuthorityCode: null,
          disabled: region.disabled,
          total: region.total,
        },
        selectedIndices,
        englandMetric
      )
    )
    .sort((left, right) => right.rate - left.rate);

  state.englandMetric = { ...englandMetric, geography: "england", code: "ENG", name: "England overview", gap: 0 };
  state.metricsByGeography = {
    msoa: new Map(msoaMetrics.map((metric) => [metric.code, metric])),
    lad: new Map(ladMetrics.map((metric) => [metric.code, metric])),
    region: new Map(regionMetrics.map((metric) => [metric.code, metric])),
  };
  state.sortedMetricsByGeography = {
    msoa: msoaMetrics,
    lad: ladMetrics,
    region: regionMetrics,
  };
  state.extremesByGeography = {
    msoa: { highest: msoaMetrics[0] || null, lowest: msoaMetrics[msoaMetrics.length - 1] || null },
    lad: { highest: ladMetrics[0] || null, lowest: ladMetrics[ladMetrics.length - 1] || null },
    region: { highest: regionMetrics[0] || null, lowest: regionMetrics[regionMetrics.length - 1] || null },
  };
  state.regionExtremesByGeography = {
    msoa: computeRegionExtremes(msoaMetrics),
    lad: computeRegionExtremes(ladMetrics),
  };
}

function getScaleForGeography(geography) {
  const values = state.sortedMetricsByGeography[geography].map((metric) =>
    state.mode === "gap" ? metric.gap : metric.rate
  );
  return state.mode === "gap"
    ? buildGapScale(values, geography)
    : buildPrevalenceScale(values, geography);
}

function updateRuntimeCollection(geography, scale) {
  runtimeCollections[geography].features.forEach((feature) => {
    const metric = state.metricsByGeography[geography].get(feature.properties.code);
    const renderValue = state.mode === "gap" ? metric?.gap : metric?.rate;
    feature.properties.fill = scale.colorFor(renderValue);
    feature.properties.height = Number(scale.heightFor(metric).toFixed(2));
    feature.properties.rateValue = Number.isFinite(metric?.rate) ? Number(metric.rate.toFixed(6)) : null;
    feature.properties.gapValue = Number.isFinite(metric?.gap) ? Number(metric.gap.toFixed(6)) : null;
    feature.properties.renderValue = Number.isFinite(renderValue) ? Number(renderValue.toFixed(6)) : null;
  });
}

function renderLegend(scale) {
  dom.legend.innerHTML = `
    <p class="legend-title">${MODE_CONFIG[state.mode].legendTitle}</p>
    <div class="legend-scale" style="grid-template-columns: repeat(${scale.colors.length}, 1fr);">
      ${scale.colors.map((color) => `<span class="legend-swatch" style="background:${color}"></span>`).join("")}
    </div>
    <div class="legend-labels">
      <span>${scale.lowLabel}</span>
      <span>${scale.highLabel}</span>
    </div>
  `;

  dom.heightNote.innerHTML = `
    <strong>${MODE_CONFIG[state.mode].heightTitle}</strong>
    <span>${MODE_CONFIG[state.mode].heightBody}</span>
  `;
}

function getActiveMetricsMap() {
  return state.metricsByGeography[state.geography];
}

function getActiveMetricsList() {
  return state.sortedMetricsByGeography[state.geography];
}

function getActiveMetric() {
  if (state.selectedCode) {
    return getActiveMetricsMap().get(state.selectedCode) || null;
  }
  if (state.hoveredCode) {
    return getActiveMetricsMap().get(state.hoveredCode) || null;
  }
  if (state.hoveredRegionCode) {
    return state.metricsByGeography.region.get(state.hoveredRegionCode) || null;
  }
  return null;
}

function getMapReadoutMetric() {
  if (state.hoveredCode) {
    return getActiveMetricsMap().get(state.hoveredCode) || null;
  }
  if (state.selectedCode) {
    return getActiveMetricsMap().get(state.selectedCode) || null;
  }
  if (state.hoveredRegionCode) {
    return state.metricsByGeography.region.get(state.hoveredRegionCode) || null;
  }
  return null;
}

function getMetricHierarchy(metric) {
  if (!metric) {
    return "Hover or click a place to inspect it.";
  }

  if (metric.geography === "msoa") {
    return `MSOA in ${metric.localAuthorityName}, ${metric.regionName}`;
  }
  if (metric.geography === "lad") {
    return `Local authority in ${metric.regionName}`;
  }
  return "English region";
}

function getMetricReadoutLabel(metric) {
  if (!metric) {
    return "England overview";
  }
  if (state.storyActive && metric.geography === "region") {
    return "Region spotlight";
  }
  if (state.selectedCode && metric.code === state.selectedCode) {
    return `${GEOGRAPHY_CONFIG[metric.geography].label} selected`;
  }
  if (state.hoveredCode && metric.code === state.hoveredCode) {
    return `${GEOGRAPHY_CONFIG[metric.geography].label} hover`;
  }
  return GEOGRAPHY_CONFIG[metric.geography].label;
}

function getMetricReadoutContext(metric) {
  if (!metric) {
    return `${GEOGRAPHY_CONFIG[state.geography].label} view. Hover or click a place to see its figures.`;
  }

  const hierarchy = getMetricHierarchy(metric);
  if (state.storyActive && metric.geography === "region") {
    return `${hierarchy} | Story spotlight`;
  }
  if (state.selectedCode && metric.code === state.selectedCode) {
    return `${hierarchy} | Locked selection`;
  }
  if (state.hoveredCode && metric.code === state.hoveredCode) {
    return `${hierarchy} | Hover preview`;
  }
  return hierarchy;
}

function writeMetricToReadout(metric, label, contextText) {
  dom.mapReadoutLabel.textContent = label;
  dom.mapReadoutName.textContent = metric.name;
  dom.mapReadoutRegion.textContent = contextText;
  dom.mapReadoutRate.textContent = formatPercent(metric.rate);
  dom.mapReadoutGap.textContent = formatPp(metric.gap || 0);
  dom.mapReadoutDisabled.textContent = formatNumber(metric.disabled);
  dom.mapReadoutTotal.textContent = formatNumber(metric.total);
}

function renderMapReadout() {
  const metric = getMapReadoutMetric();
  if (!metric) {
    writeMetricToReadout(
      { name: "England overview", ...state.englandMetric },
      "England overview",
      `${GEOGRAPHY_CONFIG[state.geography].label} view | ${MODE_CONFIG[state.mode].label}`
    );
    return;
  }

  writeMetricToReadout(metric, getMetricReadoutLabel(metric), getMetricReadoutContext(metric));
}

function renderFocusCard() {
  const metric = getActiveMetric();

  if (!metric) {
    dom.focusName.textContent = "England overview";
    dom.focusContext.textContent = `Showing ${GEOGRAPHY_CONFIG[state.geography].plural}. Hover or click a place to keep it in focus.`;
    dom.focusRate.textContent = formatPercent(state.englandMetric.rate);
    dom.focusGap.textContent = formatPp(0);
    dom.focusDisabled.textContent = formatNumber(state.englandMetric.disabled);
    dom.focusTotal.textContent = formatNumber(state.englandMetric.total);
    return;
  }

  const hierarchy = getMetricHierarchy(metric);
  let contextText = hierarchy;
  if (state.storyActive && metric.geography === "region") {
    contextText = `${hierarchy}. The guided tour will stop as soon as you use the map.`;
  } else if (state.selectedCode && metric.code === state.selectedCode) {
    contextText = `${hierarchy}. Click elsewhere on the map to clear the locked selection.`;
  } else if (state.hoveredCode && metric.code === state.hoveredCode) {
    contextText = `${hierarchy}. Click to keep this place in focus.`;
  }

  dom.focusName.textContent = metric.name;
  dom.focusContext.textContent = contextText;
  dom.focusRate.textContent = formatPercent(metric.rate);
  dom.focusGap.textContent = formatPp(metric.gap || 0);
  dom.focusDisabled.textContent = formatNumber(metric.disabled);
  dom.focusTotal.textContent = formatNumber(metric.total);
}

function renderSnapshotCard() {
  const geo = GEOGRAPHY_CONFIG[state.geography];
  const extremes = state.extremesByGeography[state.geography];
  const regionExtremes = state.extremesByGeography.region;
  const activeSpread =
    extremes?.highest && extremes?.lowest ? extremes.highest.rate - extremes.lowest.rate : null;
  const regionalSpread =
    regionExtremes?.highest && regionExtremes?.lowest
      ? regionExtremes.highest.rate - regionExtremes.lowest.rate
      : null;

  dom.highestGeoLabel.textContent = `Highest ${geo.noun}`;
  dom.lowestGeoLabel.textContent = `Lowest ${geo.noun}`;
  dom.geoGapLabel.textContent = `${geo.shortLabel} spread`;
  dom.geoGapNote.textContent = `Difference between the highest and lowest ${geo.plural} in England`;
  dom.regionalContextLabel.textContent = "Regional spread";

  dom.highestRegionName.textContent = extremes?.highest ? extremes.highest.name : "-";
  dom.highestRegionRate.textContent = extremes?.highest
    ? `${formatPercent(extremes.highest.rate)} | ${formatPp(extremes.highest.gap)}`
    : "-";

  dom.lowestRegionName.textContent = extremes?.lowest ? extremes.lowest.name : "-";
  dom.lowestRegionRate.textContent = extremes?.lowest
    ? `${formatPercent(extremes.lowest.rate)} | ${formatPp(extremes.lowest.gap)}`
    : "-";

  dom.regionalGap.textContent = Number.isFinite(activeSpread) ? formatPp(activeSpread) : "-";
  dom.localExtremes.textContent = Number.isFinite(regionalSpread) ? formatPp(regionalSpread) : "-";
  dom.localExtremesNote.textContent =
    regionExtremes?.highest && regionExtremes?.lowest
      ? `${regionExtremes.lowest.name} is lowest at ${formatPercent(regionExtremes.lowest.rate)}, while ${regionExtremes.highest.name} is highest at ${formatPercent(regionExtremes.highest.rate)}.`
      : "-";
}

function dedupeRankingMetrics(metrics, selectedMetric, limit) {
  const records = metrics.slice(0, limit);
  if (
    selectedMetric &&
    !records.some((metric) => metric.code === selectedMetric.code) &&
    selectedMetric.geography === state.geography
  ) {
    records.pop();
    records.push(selectedMetric);
  }
  return records;
}

function focusMetric(metric, options = {}) {
  if (!metric || !mapView) {
    return;
  }

  const { duration = 950, preserveBearing = true } = options;
  const bounds = boundsByGeography[metric.geography].get(metric.code);
  if (!bounds) {
    return;
  }

  fitBoundsWithAngle(bounds, {
    padding: { top: 72, right: 72, bottom: 96, left: 72 },
    maxZoom: GEOGRAPHY_CONFIG[metric.geography].focusMaxZoom,
    duration,
    preserveBearing,
  });
}

function renderRankingCard() {
  const geo = GEOGRAPHY_CONFIG[state.geography];
  const metrics = getActiveMetricsList();
  const selectedMetric = getActiveMetric();
  const rankingMetrics = dedupeRankingMetrics(metrics, selectedMetric, 12);

  dom.rankingLabel.textContent = `${geo.label} ranking`;
  dom.rankingTitle.textContent = `Highest disability prevalence across ${geo.plural}`;

  dom.regionList.innerHTML = rankingMetrics
    .map((metric) => {
      const activeClass = metric.code === state.selectedCode || metric.code === state.hoveredCode ? "active" : "";
      const metaParts = [formatPp(metric.gap)];
      if (metric.geography === "msoa") {
        metaParts.push(metric.localAuthorityName);
        metaParts.push(metric.regionName);
      } else if (metric.geography === "lad") {
        metaParts.push(metric.regionName);
      }
      return `
        <button class="region-row ${activeClass}" type="button" data-rank-code="${metric.code}">
          <div class="region-row-header">
            <span class="region-name">${escapeHtml(metric.name)}</span>
            <span class="region-name">${formatPercent(metric.rate)}</span>
          </div>
          <div class="region-bar-track">
            <div class="region-bar-fill" style="width:${Math.max(0, Math.min(100, (metric.rate || 0) * 100)).toFixed(1)}%"></div>
          </div>
          <div class="region-meta">${escapeHtml(metaParts.join(" | "))}</div>
        </button>
      `;
    })
    .join("");

  dom.regionList.querySelectorAll("[data-rank-code]").forEach((button) => {
    button.addEventListener("click", () => {
      markUserInteracted();
      const code = button.getAttribute("data-rank-code");
      const metric = getActiveMetricsMap().get(code);
      if (!metric) {
        return;
      }
      state.selectedCode = code;
      state.hoveredCode = code;
      state.hoveredRegionCode = null;
      syncHighlightSources();
      renderPanels();
      focusMetric(metric);
      if (popup && mapView) {
        popup.setLngLat(centreOfBounds(boundsByGeography[metric.geography].get(metric.code))).setHTML(buildPopupMarkup(metric)).addTo(mapView);
      }
    });
  });
}

function renderStoryPanel() {
  if (!dom.storyPanel) {
    return;
  }

  if (state.storyActive) {
    dom.storyPanel.classList.add("active");
    dom.storyPanel.classList.remove("inactive");
    dom.storyToggle.classList.add("story-primary");
    dom.storyKicker.textContent = state.storyKicker;
    dom.storyTitle.textContent = state.storyTitle;
    dom.storyBody.textContent = state.storyBody;
    dom.storyProgress.textContent = `Step ${state.storyStepIndex + 1} of ${state.storyStepCount} | Click, drag, scroll, or use the controls to take over`;
    dom.storyToggle.textContent = "Pause story";
    return;
  }

  dom.storyPanel.classList.add("inactive");
  dom.storyPanel.classList.remove("active");
  dom.storyToggle.classList.remove("story-primary");
  dom.storyKicker.textContent = "Manual mode";
  dom.storyTitle.textContent = state.storyHasAutoStarted || state.userInteracted ? "You are in control now" : "Story mode is ready";
  dom.storyBody.textContent =
    state.storyHasAutoStarted || state.userInteracted
      ? "Use the geography switch, age filters, and rotate buttons to explore, or press Tell the story to replay the guided tour."
      : "The map will open with a guided regional tour unless you take over first.";
  dom.storyProgress.textContent = state.storyHasAutoStarted || state.userInteracted ? "Free exploration" : "Auto tour armed";
  dom.storyToggle.textContent = "Tell the story";
}

function renderPanels() {
  renderMapReadout();
  renderFocusCard();
  renderSnapshotCard();
  renderRankingCard();
  renderStoryPanel();
}

function renderModeButtons() {
  dom.modeSwitch.innerHTML = Object.entries(MODE_CONFIG)
    .map(
      ([mode, config]) => `
        <button class="segment-button ${state.mode === mode ? "active" : ""}" type="button" data-mode="${mode}">
          ${config.label}
        </button>
      `
    )
    .join("");

  dom.modeSwitch.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.getAttribute("data-mode");
      if (nextMode === state.mode) {
        return;
      }
      markUserInteracted();
      state.mode = nextMode;
      update();
    });
  });
}

function renderGeographyButtons() {
  dom.geographySwitch.innerHTML = ["lad", "region", "msoa"]
    .map((geography) => {
      const config = GEOGRAPHY_CONFIG[geography];
      return `
        <button class="segment-button ${state.geography === geography ? "active" : ""}" type="button" data-geography="${geography}">
          ${config.label}
        </button>
      `;
    })
    .join("");

  dom.geographySummary.textContent = GEOGRAPHY_CONFIG[state.geography].summary;

  dom.geographySwitch.querySelectorAll("[data-geography]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextGeography = button.getAttribute("data-geography");
      if (nextGeography === state.geography) {
        return;
      }
      markUserInteracted();
      state.geography = nextGeography;
      state.hoveredCode = null;
      state.selectedCode = null;
      state.hoveredRegionCode = null;
      popup?.remove();
      update();

      if (mapView && nextGeography === "region") {
        fitBoundsWithAngle(englandBounds, {
          padding: { top: 64, right: 64, bottom: 80, left: 64 },
          maxZoom: DEFAULT_VIEW.zoom,
          duration: 900,
          preserveBearing: true,
        });
      }
    });
  });
}

function renderAgeChips() {
  const selectedIndices = getSelectedIndices();
  const lensTitle = getLensTitle(selectedIndices);
  dom.ageSummary.textContent = getAgeSummary(selectedIndices);
  dom.mapTitle.textContent = `${MODE_CONFIG[state.mode].label} at ${GEOGRAPHY_CONFIG[state.geography].label.toLowerCase()} level`;
  dom.mapSubtitle.textContent = `${lensTitle} selected. ${GEOGRAPHY_CONFIG[state.geography].summary}`;

  dom.ageChips.innerHTML = data.ageBands
    .map((band, index) => {
      const active = state.selectedAgeIndices.has(index);
      const disabled = active && state.selectedAgeIndices.size === 1;
      return `
        <button
          class="age-chip ${active ? "active" : ""}"
          type="button"
          data-age-index="${index}"
          ${disabled ? "disabled" : ""}
        >
          <strong>${band.shortLabel}</strong>
          <span>${band.label}</span>
        </button>
      `;
    })
    .join("");

  dom.ageChips.querySelectorAll("[data-age-index]").forEach((button) => {
    button.addEventListener("click", () => {
      markUserInteracted();
      const ageIndex = Number(button.getAttribute("data-age-index"));
      if (state.selectedAgeIndices.has(ageIndex)) {
        if (state.selectedAgeIndices.size === 1) {
          return;
        }
        state.selectedAgeIndices.delete(ageIndex);
      } else {
        state.selectedAgeIndices.add(ageIndex);
      }
      update();
    });
  });
}

function fitBoundsWithAngle(bounds, options = {}) {
  if (!mapView) {
    return;
  }

  const { duration = 900, padding = 48, maxZoom, preserveBearing = false } = options;
  const pitch = preserveBearing ? mapView.getPitch() : DEFAULT_VIEW.pitch;
  const bearing = preserveBearing ? mapView.getBearing() : DEFAULT_VIEW.bearing;

  const applyAngle = () => {
    mapView?.easeTo({
      pitch,
      bearing,
      duration: duration > 0 ? 260 : 0,
    });
  };

  mapView.fitBounds(bounds, { padding, maxZoom, duration });

  if (duration > 0) {
    mapView.once("moveend", applyAngle);
    return;
  }

  window.requestAnimationFrame(applyAngle);
}

function clearStoryTimer() {
  if (storyTimer) {
    window.clearTimeout(storyTimer);
    storyTimer = null;
  }
}

function clearStoryStartTimer() {
  if (storyStartTimer) {
    window.clearTimeout(storyStartTimer);
    storyStartTimer = null;
  }
}

function clearStoryIdleListener() {
  if (!mapView || !storyIdleListenerArmed) {
    return;
  }

  mapView.off("idle", startStoryModeIfAllowed);
  storyIdleListenerArmed = false;
}

function getRegionStoryText(regionCode) {
  const extremes = state.regionExtremesByGeography.lad.get(regionCode);
  if (!extremes?.highest || !extremes?.lowest) {
    return "Local authority extremes are not available for this region.";
  }
  return `${extremes.highest.name} is highest at ${formatPercent(extremes.highest.rate)} and ${extremes.lowest.name} is lowest at ${formatPercent(extremes.lowest.rate)}.`;
}

function focusEnglandStory(duration = 1400) {
  state.selectedCode = null;
  state.hoveredCode = null;
  state.hoveredRegionCode = null;
  popup?.remove();
  syncHighlightSources();
  renderPanels();

  if (mapView) {
    fitBoundsWithAngle(englandBounds, {
      padding: { top: 72, right: 72, bottom: 96, left: 72 },
      maxZoom: DEFAULT_VIEW.zoom,
      duration,
    });
  }
}

function buildPopupMarkup(metric) {
  const kicker =
    metric.geography === "msoa"
      ? `MSOA | ${escapeHtml(metric.localAuthorityName)}, ${escapeHtml(metric.regionName)}`
      : metric.geography === "lad"
        ? `Local authority | ${escapeHtml(metric.regionName)}`
        : "Region | England";

  return `
    <p class="popup-kicker">${kicker}</p>
    <h4>${escapeHtml(metric.name)}</h4>
    <div class="popup-metrics">
      <div>
        <span class="popup-metric-label">Prevalence</span>
        <span class="popup-metric-value">${formatPercent(metric.rate)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Gap vs England</span>
        <span class="popup-metric-value">${formatPp(metric.gap)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Disabled</span>
        <span class="popup-metric-value">${formatNumber(metric.disabled)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Population</span>
        <span class="popup-metric-value">${formatNumber(metric.total)}</span>
      </div>
    </div>
  `;
}

function focusRegionStory(regionMetric, duration = 1300) {
  if (!regionMetric) {
    return;
  }

  state.selectedCode = null;
  state.hoveredCode = null;
  state.hoveredRegionCode = regionMetric.code;
  syncHighlightSources();
  renderPanels();

  const labelFeature = regionLabelByCode.get(regionMetric.code);
  const bounds = boundsByGeography.region.get(regionMetric.code);
  const anchor = labelFeature?.geometry?.coordinates || (bounds ? centreOfBounds(bounds) : DEFAULT_VIEW.center);

  if (popup && mapView) {
    popup.setLngLat(anchor).setHTML(buildPopupMarkup(regionMetric)).addTo(mapView);
  }

  if (bounds) {
    fitBoundsWithAngle(bounds, {
      padding: { top: 84, right: 84, bottom: 118, left: 84 },
      maxZoom: 7.7,
      duration,
    });
  }
}

function buildStorySteps() {
  const highestRegion = state.extremesByGeography.region?.highest;
  const lowestRegion = state.extremesByGeography.region?.lowest;
  const highestLocalAuthority = state.extremesByGeography.lad?.highest;
  const lowestLocalAuthority = state.extremesByGeography.lad?.lowest;
  const regionalGap =
    highestRegion && lowestRegion ? highestRegion.rate - lowestRegion.rate : null;
  const steps = [];

  if (highestRegion && lowestRegion) {
    const laSentence =
      highestLocalAuthority && lowestLocalAuthority
        ? `Across local authorities, ${highestLocalAuthority.name} reaches ${formatPercent(highestLocalAuthority.rate)} while ${lowestLocalAuthority.name} is at ${formatPercent(lowestLocalAuthority.rate)}.`
        : "";

    steps.push({
      kicker: "Story mode",
      title: "Massive inequality across England",
      body: `Regional averages run from ${formatPercent(lowestRegion.rate)} in ${lowestRegion.name} to ${formatPercent(highestRegion.rate)} in ${highestRegion.name}, a ${formatPp(regionalGap)} gap before you get to local detail. ${laSentence}`.trim(),
      hold: 4300,
      action: () => focusEnglandStory(1500),
    });
  }

  state.sortedMetricsByGeography.region.forEach((regionMetric, index) => {
    const label =
      index === 0
        ? "Highest regional average"
        : index === state.sortedMetricsByGeography.region.length - 1
          ? "Lowest regional average"
          : "Regional tour";

    steps.push({
      kicker: label,
      title: regionMetric.name,
      body: `${regionMetric.name} averages ${formatPercent(regionMetric.rate)} (${formatPp(regionMetric.gap)} vs England). Within the region, ${getRegionStoryText(regionMetric.code)}`,
      hold: index === 0 || index === state.sortedMetricsByGeography.region.length - 1 ? 3800 : 3200,
      action: () => focusRegionStory(regionMetric),
    });
  });

  return steps;
}

function stopStoryMode({ userTookControl = false } = {}) {
  clearStoryTimer();
  clearStoryStartTimer();
  clearStoryIdleListener();
  storyRunId += 1;

  if (userTookControl) {
    state.userInteracted = true;
  }

  state.storyActive = false;
  state.hoveredRegionCode = null;
  popup?.remove();
  syncHighlightSources();
  renderPanels();
}

function markUserInteracted() {
  if (!state.userInteracted) {
    state.userInteracted = true;
  }

  if (state.storyActive || storyStartTimer) {
    stopStoryMode({ userTookControl: true });
    return;
  }

  renderStoryPanel();
}

function startStoryMode() {
  if (!mapView) {
    return;
  }

  clearStoryTimer();
  clearStoryStartTimer();
  clearStoryIdleListener();
  storyRunId += 1;

  const runId = storyRunId;
  const steps = buildStorySteps();
  if (!steps.length) {
    return;
  }

  state.storyActive = true;
  state.storyStepCount = steps.length;

  const runStep = (index) => {
    if (runId !== storyRunId || !state.storyActive) {
      return;
    }

    const step = steps[index % steps.length];
    state.storyStepIndex = index % steps.length;
    state.storyKicker = step.kicker;
    state.storyTitle = step.title;
    state.storyBody = step.body;
    renderPanels();
    step.action();

    clearStoryTimer();
    storyTimer = window.setTimeout(() => runStep((index + 1) % steps.length), step.hold || 3200);
  };

  runStep(0);
}

function startStoryModeIfAllowed() {
  if (!mapView || state.userInteracted || state.storyActive || state.storyHasAutoStarted) {
    return;
  }

  state.storyHasAutoStarted = true;
  startStoryMode();
}

function queueInitialStoryStart() {
  if (!mapView || state.userInteracted || state.storyHasAutoStarted) {
    return;
  }

  clearStoryStartTimer();
  clearStoryIdleListener();
  mapView.on("idle", startStoryModeIfAllowed);
  storyIdleListenerArmed = true;
  storyStartTimer = window.setTimeout(() => {
    startStoryModeIfAllowed();
  }, 1200);
}

function rotateMap(step) {
  if (!mapView) {
    return;
  }

  markUserInteracted();
  mapView.easeTo({
    bearing: mapView.getBearing() + step,
    pitch: mapView.getPitch(),
    duration: 720,
  });
}

function setSourceFeature(sourceName, feature) {
  const source = mapLoaded && mapView ? mapView.getSource(sourceName) : null;
  if (!source) {
    return;
  }

  source.setData(feature ? { type: "FeatureCollection", features: [feature] } : EMPTY_COLLECTION);
}

function syncHighlightSources() {
  const activeFeatureMap = runtimeFeatureByGeography[state.geography];
  const hoverFeature =
    state.hoveredCode && state.hoveredCode !== state.selectedCode ? activeFeatureMap.get(state.hoveredCode) : null;
  const selectionFeature = state.selectedCode ? activeFeatureMap.get(state.selectedCode) : null;
  const regionFeature = state.hoveredRegionCode ? runtimeFeatureByGeography.region.get(state.hoveredRegionCode) : null;

  setSourceFeature("hover-feature", hoverFeature || null);
  setSourceFeature("selection-feature", selectionFeature || null);
  setSourceFeature("region-hover-feature", regionFeature || null);
}

function setHoveredCode(code, lngLat) {
  state.hoveredRegionCode = null;
  state.hoveredCode = code;
  syncHighlightSources();
  renderPanels();

  if (!popup || !mapView || !code) {
    popup?.remove();
    return;
  }

  const metric = getActiveMetricsMap().get(code);
  if (!metric) {
    popup.remove();
    return;
  }

  popup.setLngLat(lngLat).setHTML(buildPopupMarkup(metric)).addTo(mapView);
}

function setHoveredRegionCode(code) {
  state.hoveredCode = null;
  state.hoveredRegionCode = code;
  syncHighlightSources();
  renderPanels();
}

function getFeatureCode(geography, feature) {
  if (geography === "msoa") {
    return feature?.properties?.code || feature?.properties?.c || null;
  }
  return feature?.properties?.code || null;
}

function attachAreaInteractions(geography) {
  const layerId = GEOGRAPHY_CONFIG[geography].activeLayer;

  mapView.on("mousemove", layerId, (event) => {
    if (state.geography !== geography || state.storyActive) {
      return;
    }

    const feature = event.features?.[0];
    const code = getFeatureCode(geography, feature);
    if (!code) {
      return;
    }

    mapView.getCanvas().style.cursor = "pointer";
    setHoveredCode(code, event.lngLat);
  });

  mapView.on("mouseleave", layerId, () => {
    if (state.geography !== geography || state.storyActive) {
      return;
    }

    mapView.getCanvas().style.cursor = "";
    state.hoveredCode = null;
    syncHighlightSources();
    renderPanels();
    popup?.remove();
  });

  mapView.on("click", layerId, (event) => {
    if (state.geography !== geography) {
      return;
    }

    const feature = event.features?.[0];
    const code = getFeatureCode(geography, feature);
    if (!code) {
      return;
    }

    markUserInteracted();
    state.selectedCode = state.selectedCode === code ? null : code;
    state.hoveredCode = code;
    state.hoveredRegionCode = null;
    syncHighlightSources();
    renderPanels();

    const metric = getActiveMetricsMap().get(code);
    if (metric && popup && mapView) {
      popup.setLngLat(event.lngLat).setHTML(buildPopupMarkup(metric)).addTo(mapView);
    }
  });
}

function attachMapInteractions() {
  if (!mapView) {
    return;
  }

  mapView.on("dragstart", (event) => {
    if (event.originalEvent) {
      markUserInteracted();
    }
  });
  mapView.on("zoomstart", (event) => {
    if (event.originalEvent) {
      markUserInteracted();
    }
  });
  mapView.on("pitchstart", (event) => {
    if (event.originalEvent) {
      markUserInteracted();
    }
  });

  ["region", "lad", "msoa"].forEach(attachAreaInteractions);

  mapView.on("click", (event) => {
    const activeLayer = GEOGRAPHY_CONFIG[state.geography].activeLayer;
    const features = mapView.queryRenderedFeatures(event.point, { layers: [activeLayer] });
    if (features.length) {
      return;
    }

    markUserInteracted();
    state.selectedCode = null;
    state.hoveredCode = null;
    state.hoveredRegionCode = null;
    syncHighlightSources();
    renderPanels();
    popup?.remove();
  });
}

function syncLayerVisibility() {
  if (!mapLoaded || !mapView) {
    return;
  }

  Object.entries(LAYER_GROUPS).forEach(([geography, layerIds]) => {
    const visibility = state.geography === geography ? "visible" : "none";
    layerIds.forEach((layerId) => {
      if (mapView.getLayer(layerId)) {
        mapView.setLayoutProperty(layerId, "visibility", visibility);
      }
    });
  });
}

function attachStaticEvents() {
  dom.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      markUserInteracted();
      const preset = button.getAttribute("data-preset");
      state.selectedAgeIndices = new Set(PRESETS[preset]);
      update();
    });
  });

  dom.resetView.addEventListener("click", () => {
    markUserInteracted();
    state.selectedCode = null;
    state.hoveredCode = null;
    state.hoveredRegionCode = null;
    popup?.remove();
    syncHighlightSources();
    renderPanels();
    if (mapView) {
      fitBoundsWithAngle(englandBounds, {
        padding: { top: 72, right: 72, bottom: 72, left: 72 },
        maxZoom: DEFAULT_VIEW.zoom,
        duration: 1200,
      });
    }
  });

  dom.fullscreenMap.addEventListener("click", async () => {
    markUserInteracted();
    const panel = document.querySelector(".map-panel");
    if (!panel) {
      return;
    }

    if (document.fullscreenElement === panel) {
      await document.exitFullscreen();
      return;
    }

    await panel.requestFullscreen();
  });

  dom.storyToggle.addEventListener("click", () => {
    if (state.storyActive) {
      markUserInteracted();
      return;
    }
    startStoryMode();
  });

  dom.rotateLeft.addEventListener("click", () => rotateMap(-36));
  dom.rotateRight.addEventListener("click", () => rotateMap(36));

  document.addEventListener("fullscreenchange", () => {
    dom.fullscreenMap.textContent =
      document.fullscreenElement?.classList.contains("map-panel") ? "Exit full screen" : "Full screen";
    window.setTimeout(() => mapView?.resize(), 120);
  });
}

function updateMap() {
  if (!mapLoaded || !mapView) {
    return;
  }

  const scales = {
    msoa: getScaleForGeography("msoa"),
    lad: getScaleForGeography("lad"),
    region: getScaleForGeography("region"),
  };

  updateRuntimeCollection("msoa", scales.msoa);
  updateRuntimeCollection("lad", scales.lad);
  updateRuntimeCollection("region", scales.region);

  mapView.getSource("msoas").setData(runtimeCollections.msoa);
  mapView.getSource("lads").setData(runtimeCollections.lad);
  mapView.getSource("regions").setData(runtimeCollections.region);
  renderLegend(scales[state.geography]);
  syncLayerVisibility();
  syncHighlightSources();
}

function update() {
  if (!state.selectedCode) {
    state.hoveredCode = null;
  }

  computeMetrics();
  renderGeographyButtons();
  renderModeButtons();
  renderAgeChips();
  renderPanels();
  updateMap();
}

try {
  if (mapView) {
    mapView.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapView.scrollZoom.setWheelZoomRate(1 / 980);
    mapView.scrollZoom.setZoomRate(1 / 160);
    mapView.dragRotate.disable();
    mapView.touchZoomRotate.disableRotation();
    popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "metric-popup",
      offset: 18,
    });
  }

  attachStaticEvents();
  computeMetrics();
  renderGeographyButtons();
  renderModeButtons();
  renderAgeChips();
  renderPanels();
  renderLegend(getScaleForGeography(state.geography));

  if (!mapView) {
    dom.heightNote.innerHTML =
      "<strong>3D unavailable</strong><span>This browser could not start the WebGL map, but the figures and controls are still available.</span>";
  }
} catch (error) {
  console.error(error);
  dom.heightNote.innerHTML =
    "<strong>Map error</strong><span>The 3D map could not finish loading in this browser session.</span>";
  throw error;
}
