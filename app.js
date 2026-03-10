const data = window.DISABILITY_MAP_DATA;

if (!data || !window.maplibregl) {
  throw new Error("Map dependencies did not load.");
}

const MODE_CONFIG = {
  prevalence: {
    label: "Prevalence",
    legendTitle: "Disabled residents as a share of the selected population",
    heightTitle: "3D height",
    heightBody: "Taller regions and neighbourhoods mean higher disability prevalence in the chosen age groups.",
  },
  gap: {
    label: "Gap vs England",
    legendTitle: "Percentage-point gap from the England average",
    heightTitle: "3D height",
    heightBody: "Taller forms mean a bigger gap from the England average. Blue is below average, coral is above.",
  },
};

const PRESETS = {
  all: data.ageBands.map((_, index) => index),
  working: [2, 3, 4, 5, 6, 7, 8],
  older: [9, 10, 11],
};

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const DEFAULT_VIEW = {
  center: [-2.55, 53.2],
  zoom: 5.85,
  pitch: 56,
  bearing: 0,
};

const state = {
  selectedAgeIndices: new Set(PRESETS.all),
  mode: "prevalence",
  hoveredCode: null,
  hoveredRegionCode: null,
  selectedCode: null,
  userInteracted: false,
  storyActive: false,
  storyHasAutoStarted: false,
  storyKicker: "Story mode",
  storyTitle: "Massive inequality across England",
  storyBody: "The map will guide you through the regional picture until you take control.",
  storyStepIndex: 0,
  storyStepCount: 0,
  metricsByCode: new Map(),
  regionMetricsByCode: new Map(),
  regionExtremesByCode: new Map(),
  regionMetrics: [],
  englandMetric: null,
  localExtremes: null,
};

const dom = {
  modeSwitch: document.querySelector("#mode-switch"),
  ageChips: document.querySelector("#age-chips"),
  ageSummary: document.querySelector("#age-summary"),
  mapTitle: document.querySelector("#map-title"),
  legend: document.querySelector("#legend"),
  heightNote: document.querySelector("#height-note"),
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
  highestRegionName: document.querySelector("#highest-region-name"),
  highestRegionRate: document.querySelector("#highest-region-rate"),
  lowestRegionName: document.querySelector("#lowest-region-name"),
  lowestRegionRate: document.querySelector("#lowest-region-rate"),
  regionalGap: document.querySelector("#regional-gap"),
  localExtremes: document.querySelector("#local-extremes"),
  localExtremesNote: document.querySelector("#local-extremes-note"),
  regionList: document.querySelector("#region-list"),
  fullscreenMap: document.querySelector("#fullscreen-map"),
  resetView: document.querySelector("#reset-view"),
  presetButtons: Array.from(document.querySelectorAll(".preset-button")),
};

const runtimeMsoas = {
  type: "FeatureCollection",
  features: data.msoas.features.map((feature) => ({
    type: "Feature",
    id: feature.id ?? feature.properties.c,
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      fill: "#d6f0f0",
      height: 0,
      rateValue: null,
      gapValue: null,
      renderValue: null,
    },
  })),
};
const runtimeRegions = {
  type: "FeatureCollection",
  features: data.regionBoundaries.features.map((feature) => ({
    type: "Feature",
    id: feature.id ?? feature.properties.code,
    geometry: feature.geometry,
    properties: {
      ...feature.properties,
      fill: "#d6f0f0",
      height: 0,
      rateValue: null,
      gapValue: null,
      renderValue: null,
    },
  })),
};

const runtimeFeatureByCode = new Map(
  runtimeMsoas.features.map((feature) => [feature.properties.c, feature])
);
const runtimeRegionFeatureByCode = new Map(
  runtimeRegions.features.map((feature) => [feature.properties.code, feature])
);
const regionLabelByCode = new Map(
  (data.regionLabels?.features || []).map((feature) => [feature.properties.code, feature])
);
const regionBoundsByCode = new Map(
  data.regionBoundaries.features.map((feature) => [feature.properties.code, boundsFromGeometry(feature.geometry)])
);
const englandBounds = boundsFromGeometryCollection(data.regionBoundaries.features);

let mapView = null;
try {
  mapView = new maplibregl.Map({
    container: "map",
    antialias: true,
    dragRotate: false,
    pitchWithRotate: false,
    minZoom: 4.8,
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
      layers: [
        {
          id: "carto-base",
          type: "raster",
          source: "carto",
        },
      ],
    },
  });
} catch (error) {
  console.error("Unable to initialise the 3D map.", error);
}

let popup;
let storyTimer = null;
let storyStartTimer = null;
let storyRunId = 0;
let storyIdleListenerArmed = false;

let mapLoaded = false;
const regionColumnMarkers = new Map();

if (mapView) {
  mapView.on("load", () => {
    mapLoaded = true;

    mapView.addSource("msoas", {
      type: "geojson",
      data: runtimeMsoas,
    });

    mapView.addSource("regions", {
      type: "geojson",
      data: runtimeRegions,
    });

    mapView.addSource("hover-feature", {
      type: "geojson",
      data: EMPTY_COLLECTION,
    });

    mapView.addSource("region-hover-feature", {
      type: "geojson",
      data: EMPTY_COLLECTION,
    });

    mapView.addSource("selection-feature", {
      type: "geojson",
      data: EMPTY_COLLECTION,
    });

    mapView.addLayer({
      id: "region-footprint",
      type: "fill",
      source: "regions",
      maxzoom: 7.35,
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": 0.5,
      },
    });

    mapView.addLayer({
      id: "region-extrusions",
      type: "fill-extrusion",
      source: "regions",
      maxzoom: 7.35,
      paint: {
        "fill-extrusion-color": ["get", "fill"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    mapView.addLayer({
      id: "msoa-footprint",
      type: "fill",
      source: "msoas",
      minzoom: 5.45,
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5.45,
          0.22,
          6.2,
          0.42,
          7.2,
          0.72,
          10.5,
          0.84,
        ],
      },
    });

    mapView.addLayer({
      id: "msoa-extrusions",
      type: "fill-extrusion",
      source: "msoas",
      minzoom: 5.95,
      paint: {
        "fill-extrusion-color": ["get", "fill"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5.95,
          0.42,
          6.8,
          0.78,
          7.5,
          0.95,
          11,
          0.98,
        ],
        "fill-extrusion-vertical-gradient": true,
      },
    });

    mapView.addLayer({
      id: "msoa-outline",
      type: "line",
      source: "msoas",
      minzoom: 7.25,
      paint: {
        "line-color": "#f5fcff",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          7.25,
          0.14,
          8,
          0.45,
          11,
          0.85,
        ],
        "line-opacity": 0.28,
      },
    });

    mapView.addLayer({
      id: "hover-outline",
      type: "line",
      source: "hover-feature",
      paint: {
        "line-color": "#f6feff",
        "line-width": 2.5,
        "line-opacity": 0.95,
      },
    });

    mapView.addLayer({
      id: "region-hover-outline",
      type: "line",
      source: "region-hover-feature",
      maxzoom: 7.35,
      paint: {
        "line-color": "#f6feff",
        "line-width": 2.4,
        "line-opacity": 0.92,
      },
    });

    mapView.addLayer({
      id: "selection-outline",
      type: "line",
      source: "selection-feature",
      paint: {
        "line-color": "#0f766e",
        "line-width": 3.2,
        "line-opacity": 0.95,
      },
    });

    createRegionLabels();
    attachMapInteractions();
    update();
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

function buildPrevalenceScale(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const thresholds = uniqueAscending([
    quantile(sorted, 0.15),
    quantile(sorted, 0.35),
    quantile(sorted, 0.55),
    quantile(sorted, 0.75),
    quantile(sorted, 0.9),
  ]);
  const colors = ["#ecfbff", "#c9f3f2", "#88ded8", "#44c3c6", "#1b8fab", "#0d4f71"];
  const maxRate = sorted[sorted.length - 1] || 0.25;
  const heightScale = maxRate > 0 ? 52000 / maxRate : 0;

  return {
    colors,
    colorFor(value) {
      if (!Number.isFinite(value)) {
        return "#d8d5cf";
      }
      const index = thresholds.findIndex((threshold) => value <= threshold);
      return colors[index === -1 ? colors.length - 1 : index];
    },
    heightFor(metric) {
      if (!Number.isFinite(metric.rate)) {
        return 0;
      }
      return Math.max(metric.rate * heightScale, 120);
    },
    lowLabel: formatPercent(sorted[0] || 0),
    highLabel: formatPercent(sorted[sorted.length - 1] || 0),
  };
}

function buildGapScale(values) {
  const absolute = values
    .filter(Number.isFinite)
    .map((value) => Math.abs(value))
    .sort((left, right) => left - right);

  const t1 = Math.max(quantile(absolute, 0.45), 0.003);
  const t2 = Math.max(quantile(absolute, 0.7), t1 + 0.002);
  const t3 = Math.max(quantile(absolute, 0.9), t2 + 0.002);
  const maxAbs = absolute[absolute.length - 1] || t3 || 0.01;
  const heightScale = maxAbs > 0 ? 60000 / maxAbs : 0;
  const colors = ["#204a72", "#3f78a6", "#a9d2eb", "#f7f7f4", "#ffd1bb", "#ff8f7d", "#de5d73"];

  return {
    colors,
    colorFor(value) {
      if (!Number.isFinite(value)) {
        return "#d8d5cf";
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
      return Math.max(Math.abs(metric.gap) * heightScale, 120);
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

function computeMetrics() {
  const selectedIndices = getSelectedIndices();
  const englandMetric = summariseArrays(data.england.disabled, data.england.total, selectedIndices);
  const metricsByCode = new Map();
  const regionExtremesByCode = new Map();

  let highestFeature = null;
  let lowestFeature = null;

  data.msoas.features.forEach((feature) => {
    const metric = summariseArrays(feature.properties.d, feature.properties.t, selectedIndices);
    const record = {
      code: feature.properties.c,
      name: feature.properties.n,
      region: feature.properties.r,
      regionCode: feature.properties.rc,
      feature,
      ...metric,
      gap: Number.isFinite(metric.rate) ? metric.rate - englandMetric.rate : null,
    };

    metricsByCode.set(record.code, record);

    if (Number.isFinite(record.rate)) {
      const regionalExtremes = regionExtremesByCode.get(record.regionCode) || {
        highest: null,
        lowest: null,
      };
      if (!regionalExtremes.highest || record.rate > regionalExtremes.highest.rate) {
        regionalExtremes.highest = record;
      }
      if (!regionalExtremes.lowest || record.rate < regionalExtremes.lowest.rate) {
        regionalExtremes.lowest = record;
      }
      regionExtremesByCode.set(record.regionCode, regionalExtremes);

      if (!highestFeature || record.rate > highestFeature.rate) {
        highestFeature = record;
      }
      if (!lowestFeature || record.rate < lowestFeature.rate) {
        lowestFeature = record;
      }
    }
  });

  const regionMetrics = data.regions
    .map((region) => {
      const metric = summariseArrays(region.disabled, region.total, selectedIndices);
      return {
        ...region,
        ...metric,
        gap: Number.isFinite(metric.rate) ? metric.rate - englandMetric.rate : null,
      };
    })
    .sort((left, right) => right.rate - left.rate);

  state.metricsByCode = metricsByCode;
  state.regionMetricsByCode = new Map(regionMetrics.map((region) => [region.code, region]));
  state.regionExtremesByCode = regionExtremesByCode;
  state.regionMetrics = regionMetrics;
  state.englandMetric = { ...englandMetric, gap: 0 };
  state.localExtremes = {
    highest: highestFeature,
    lowest: lowestFeature,
  };
}

function getScale() {
  const values = Array.from(state.metricsByCode.values()).map((metric) =>
    state.mode === "gap" ? metric.gap : metric.rate
  );
  return state.mode === "gap" ? buildGapScale(values) : buildPrevalenceScale(values);
}

function updateRuntimeFeatures(scale) {
  runtimeMsoas.features.forEach((feature) => {
    const metric = state.metricsByCode.get(feature.properties.c);
    const renderValue = state.mode === "gap" ? metric.gap : metric.rate;
    feature.properties.fill = scale.colorFor(renderValue);
    feature.properties.height = Number(scale.heightFor(metric).toFixed(2));
    feature.properties.rateValue = Number.isFinite(metric.rate) ? Number(metric.rate.toFixed(6)) : null;
    feature.properties.gapValue = Number.isFinite(metric.gap) ? Number(metric.gap.toFixed(6)) : null;
    feature.properties.renderValue = Number.isFinite(renderValue) ? Number(renderValue.toFixed(6)) : null;
  });
}

function renderLegend(scale) {
  const colors = scale.colors;
  dom.legend.innerHTML = `
    <p class="legend-title">${MODE_CONFIG[state.mode].legendTitle}</p>
    <div class="legend-scale" style="grid-template-columns: repeat(${colors.length}, 1fr);">
      ${colors.map((color) => `<span class="legend-swatch" style="background:${color}"></span>`).join("")}
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

function getActiveMetric() {
  if (state.selectedCode) {
    return state.metricsByCode.get(state.selectedCode) || null;
  }
  if (state.hoveredCode) {
    return state.metricsByCode.get(state.hoveredCode) || null;
  }
  if (state.hoveredRegionCode) {
    return state.regionMetricsByCode.get(state.hoveredRegionCode) || null;
  }
  return null;
}

function getMapReadoutMetric() {
  if (state.hoveredCode) {
    return state.metricsByCode.get(state.hoveredCode) || null;
  }
  if (state.selectedCode) {
    return state.metricsByCode.get(state.selectedCode) || null;
  }
  if (state.hoveredRegionCode) {
    return state.regionMetricsByCode.get(state.hoveredRegionCode) || null;
  }
  return null;
}

function writeMapReadout(sourceMetric, contextText) {
  dom.mapReadoutName.textContent = sourceMetric.name;
  dom.mapReadoutRegion.textContent = contextText;
  dom.mapReadoutRate.textContent = formatPercent(sourceMetric.rate);
  dom.mapReadoutGap.textContent = formatPp(sourceMetric.gap || 0);
  dom.mapReadoutDisabled.textContent = formatNumber(sourceMetric.disabled);
  dom.mapReadoutTotal.textContent = formatNumber(sourceMetric.total);
}

function renderMapReadout() {
  const activeMetric = getMapReadoutMetric();
  const sourceMetric = activeMetric || {
    name: "England overview",
    region: "England",
    ...state.englandMetric,
  };

  let contextText = "Hover over an area to see its figures and region.";
  if (state.storyActive && activeMetric) {
    contextText = state.hoveredRegionCode
      ? `${sourceMetric.name} | Story spotlight`
      : `${sourceMetric.region} | Story spotlight`;
  } else if (state.storyActive) {
    contextText = "England | Story overview";
  } else if (state.selectedCode && activeMetric) {
    contextText = `${sourceMetric.region} | Locked selection`;
  } else if (state.hoveredCode && activeMetric) {
    contextText = `${sourceMetric.region} | Hover preview`;
  } else if (state.hoveredRegionCode && activeMetric) {
    contextText = `${sourceMetric.name} | Regional average`;
  }

  writeMapReadout(sourceMetric, contextText);
}

function renderFocusCard() {
  const activeMetric = getActiveMetric();
  const sourceMetric = activeMetric || {
    name: "England overview",
    region: "England",
    ...state.englandMetric,
  };

  let contextText = "Hover over an area for a quick read, or click to lock the selection.";
  if (state.storyActive && activeMetric) {
    contextText = state.hoveredRegionCode
      ? `${sourceMetric.name} | Story spotlight. The guided tour will stop as soon as you use the map.`
      : `${sourceMetric.region} | Story spotlight. The guided tour will stop as soon as you use the map.`;
  } else if (state.storyActive) {
    contextText = "England | Story overview. Click, scroll, or use the controls to take over.";
  } else if (state.selectedCode && activeMetric) {
    contextText = `${sourceMetric.region} | Click elsewhere on the map to clear the locked selection.`;
  } else if (state.hoveredCode && activeMetric) {
    contextText = `${sourceMetric.region} | Hover preview. Click to keep this area in focus.`;
  } else if (state.hoveredRegionCode && activeMetric) {
    contextText = `${sourceMetric.name} | Regional average. Zoom in to move from the regional picture to local neighbourhoods.`;
  }

  dom.focusName.textContent = sourceMetric.name;
  dom.focusContext.textContent = contextText;
  dom.focusRate.textContent = formatPercent(sourceMetric.rate);
  dom.focusGap.textContent = formatPp(sourceMetric.gap || 0);
  dom.focusDisabled.textContent = formatNumber(sourceMetric.disabled);
  dom.focusTotal.textContent = formatNumber(sourceMetric.total);
}

function renderSnapshotCard() {
  const highestRegion = state.regionMetrics[0];
  const lowestRegion = state.regionMetrics[state.regionMetrics.length - 1];
  const regionalGap = highestRegion && lowestRegion ? highestRegion.rate - lowestRegion.rate : null;
  const localExtremes = state.localExtremes;

  dom.highestRegionName.textContent = highestRegion ? highestRegion.name : "-";
  dom.highestRegionRate.textContent = highestRegion
    ? `${formatPercent(highestRegion.rate)} | ${formatPp(highestRegion.gap)}`
    : "-";

  dom.lowestRegionName.textContent = lowestRegion ? lowestRegion.name : "-";
  dom.lowestRegionRate.textContent = lowestRegion
    ? `${formatPercent(lowestRegion.rate)} | ${formatPp(lowestRegion.gap)}`
    : "-";

  dom.regionalGap.textContent = Number.isFinite(regionalGap) ? formatPp(regionalGap) : "-";

  if (localExtremes?.highest && localExtremes?.lowest) {
    const spread = localExtremes.highest.rate - localExtremes.lowest.rate;
    dom.localExtremes.textContent = formatPp(spread);
    dom.localExtremesNote.textContent = `${localExtremes.highest.name} is highest at ${formatPercent(localExtremes.highest.rate)}, while ${localExtremes.lowest.name} is lowest at ${formatPercent(localExtremes.lowest.rate)}.`;
  } else {
    dom.localExtremes.textContent = "-";
    dom.localExtremesNote.textContent = "-";
  }
}

function renderRegionList() {
  const selectedMetric = getActiveMetric();
  const activeRegionCode = selectedMetric?.regionCode || null;

  dom.regionList.innerHTML = state.regionMetrics
    .map((region) => {
      const width = (region.rate || 0) * 100;
      const activeClass = activeRegionCode === region.code ? "active" : "";
      return `
        <button class="region-row ${activeClass}" type="button" data-region-code="${region.code}">
          <div class="region-row-header">
            <span class="region-name">${region.name}</span>
            <span class="region-name">${formatPercent(region.rate)}</span>
          </div>
          <div class="region-bar-track">
            <div class="region-bar-fill" style="width:${width}%"></div>
          </div>
          <div class="region-meta">${formatPp(region.gap)} vs England average</div>
        </button>
      `;
    })
    .join("");

  dom.regionList.querySelectorAll("[data-region-code]").forEach((button) => {
    button.addEventListener("click", () => {
      markUserInteracted();
      const regionCode = button.getAttribute("data-region-code");
      const bounds = regionBoundsByCode.get(regionCode);
      if (bounds && mapView) {
        fitBoundsWithAngle(bounds, { padding: 50, maxZoom: 8.1, duration: 950 });
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
    dom.storyProgress.textContent = `Step ${state.storyStepIndex + 1} of ${state.storyStepCount} | Click, scroll, or use the controls to take over`;
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
      ? "Press Tell the story to replay the guided tour, or use Rotate left and Rotate right to sweep around the 3D view."
      : "The map will open with a guided regional tour unless you take over first.";
  dom.storyProgress.textContent = state.storyHasAutoStarted || state.userInteracted ? "Free exploration" : "Auto tour armed";
  dom.storyToggle.textContent = "Tell the story";
}

function renderPanels() {
  renderMapReadout();
  renderFocusCard();
  renderSnapshotCard();
  renderRegionList();
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
      markUserInteracted();
      state.mode = button.getAttribute("data-mode");
      update();
    });
  });
}

function renderAgeChips() {
  const selectedIndices = getSelectedIndices();
  dom.ageSummary.textContent = getAgeSummary(selectedIndices);
  dom.mapTitle.textContent = getLensTitle(selectedIndices);

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

  const { duration = 900, padding = 48, maxZoom } = options;
  const applyAngle = () => {
    mapView?.easeTo({
      pitch: DEFAULT_VIEW.pitch,
      bearing: DEFAULT_VIEW.bearing,
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

function centerOfBounds(bounds) {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

function getRegionStoryText(regionCode) {
  const extremes = state.regionExtremesByCode.get(regionCode);
  if (!extremes?.highest || !extremes?.lowest) {
    return "Local extremes are not available for this region.";
  }
  return `Highest local area: ${extremes.highest.name} at ${formatPercent(extremes.highest.rate)}. Lowest: ${extremes.lowest.name} at ${formatPercent(extremes.lowest.rate)}.`;
}

function focusEnglandStory(duration = 1400) {
  state.selectedCode = null;
  state.hoveredCode = null;
  state.hoveredRegionCode = null;
  syncHighlightSources();
  renderPanels();
  popup?.remove();

  if (mapView) {
    fitBoundsWithAngle(englandBounds, {
      padding: { top: 72, right: 72, bottom: 92, left: 72 },
      maxZoom: DEFAULT_VIEW.zoom,
      duration,
    });
  }
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
  const bounds = regionBoundsByCode.get(regionMetric.code);
  const anchor = labelFeature?.geometry?.coordinates || (bounds ? centerOfBounds(bounds) : DEFAULT_VIEW.center);

  if (popup) {
    popup.setLngLat(anchor).setHTML(buildRegionPopupMarkup(regionMetric)).addTo(mapView);
  }

  if (bounds) {
    fitBoundsWithAngle(bounds, {
      padding: { top: 92, right: 84, bottom: 118, left: 84 },
      maxZoom: 7.95,
      duration,
    });
  }
}

function buildStorySteps() {
  const highestRegion = state.regionMetrics[0];
  const lowestRegion = state.regionMetrics[state.regionMetrics.length - 1];
  const regionalGap = highestRegion && lowestRegion ? highestRegion.rate - lowestRegion.rate : null;
  const steps = [];

  if (highestRegion && lowestRegion) {
    steps.push({
      kicker: "Story mode",
      title: "Massive inequality across England",
      body: `Regional averages run from ${formatPercent(lowestRegion.rate)} in ${lowestRegion.name} to ${formatPercent(highestRegion.rate)} in ${highestRegion.name}. That is a ${formatPp(regionalGap)} gap before you even zoom into local neighbourhoods.`,
      hold: 4200,
      action: () => focusEnglandStory(1500),
    });
  }

  state.regionMetrics.forEach((region, index) => {
    const stepLabel =
      index === 0
        ? "Highest regional average"
        : index === state.regionMetrics.length - 1
          ? "Lowest regional average"
          : "Regional tour";

    steps.push({
      kicker: stepLabel,
      title: region.name,
      body: `${region.name} averages ${formatPercent(region.rate)} (${formatPp(region.gap)} vs England). ${getRegionStoryText(region.code)}`,
      hold: index === 0 || index === state.regionMetrics.length - 1 ? 3600 : 3000,
      action: () => focusRegionStory(region),
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

  if (!state.storyActive) {
    renderStoryPanel();
    return;
  }

  state.storyActive = false;
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
    duration: 700,
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
  const hoverFeature =
    state.hoveredCode && state.hoveredCode !== state.selectedCode
      ? runtimeFeatureByCode.get(state.hoveredCode)
      : null;
  const selectionFeature = state.selectedCode ? runtimeFeatureByCode.get(state.selectedCode) : null;

  setSourceFeature("hover-feature", hoverFeature || null);
  setSourceFeature("selection-feature", selectionFeature || null);
  setSourceFeature("region-hover-feature", state.hoveredRegionCode ? runtimeRegionFeatureByCode.get(state.hoveredRegionCode) : null);
}

function buildPopupMarkup(metric) {
  return `
    <p class="popup-kicker">${escapeHtml(metric.region)}</p>
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

function setHoveredCode(code, lngLat) {
  state.hoveredRegionCode = null;
  state.hoveredCode = code;
  syncHighlightSources();
  renderPanels();

  if (!popup || !mapView || !code) {
    popup?.remove();
    return;
  }

  const metric = state.metricsByCode.get(code);
  if (!metric) {
    popup.remove();
    return;
  }

  popup.setLngLat(lngLat).setHTML(buildPopupMarkup(metric)).addTo(mapView);
}

function setHoveredRegionCode(code, lngLat, forcePopup = true) {
  state.hoveredCode = null;
  state.hoveredRegionCode = code;
  syncHighlightSources();
  renderPanels();

  if (!popup || !mapView || !code || !forcePopup) {
    if (!code) {
      popup?.remove();
    }
    return;
  }

  const metric = state.regionMetricsByCode.get(code);
  if (!metric) {
    popup.remove();
    return;
  }

  popup.setLngLat(lngLat).setHTML(buildRegionPopupMarkup(metric)).addTo(mapView);
}

function attachMapInteractions() {
  if (!mapView) {
    return;
  }

  const canvasContainer = mapView.getCanvasContainer();
  ["pointerdown", "wheel", "touchstart"].forEach((eventName) => {
    canvasContainer.addEventListener(
      eventName,
      () => {
        markUserInteracted();
      },
      { passive: true }
    );
  });

  const handleRegionHover = (event) => {
    const feature = event.features?.[0];
    if (!feature?.properties?.code) {
      return;
    }

    mapView.getCanvas().style.cursor = "pointer";
    setHoveredRegionCode(feature.properties.code, event.lngLat);
  };

  mapView.on("mousemove", "region-extrusions", handleRegionHover);

  mapView.on("mouseleave", "region-extrusions", () => {
    mapView.getCanvas().style.cursor = "";
    state.hoveredRegionCode = null;
    syncHighlightSources();
    renderPanels();
    popup.remove();
  });

  mapView.on("click", "region-extrusions", (event) => {
    const feature = event.features?.[0];
    if (!feature?.properties?.code) {
      return;
    }

    markUserInteracted();
    const regionCode = feature.properties.code;
    const bounds = regionBoundsByCode.get(regionCode);
    const metric = state.regionMetricsByCode.get(regionCode);

    state.hoveredRegionCode = regionCode;
    syncHighlightSources();
    renderPanels();

    if (metric) {
      popup.setLngLat(event.lngLat).setHTML(buildRegionPopupMarkup(metric)).addTo(mapView);
    }

    if (bounds) {
      fitBoundsWithAngle(bounds, { padding: 50, maxZoom: 8.1, duration: 950 });
    }
  });

  mapView.on("mousemove", "msoa-extrusions", (event) => {
    const feature = event.features?.[0];
    if (!feature?.properties?.c) {
      return;
    }

    mapView.getCanvas().style.cursor = "pointer";
    setHoveredCode(feature.properties.c, event.lngLat);
  });

  mapView.on("mouseleave", "msoa-extrusions", () => {
    mapView.getCanvas().style.cursor = "";
    state.hoveredCode = null;
    syncHighlightSources();
    renderPanels();
    popup.remove();
  });

  mapView.on("click", "msoa-extrusions", (event) => {
    const feature = event.features?.[0];
    if (!feature?.properties?.c) {
      return;
    }

    markUserInteracted();
    state.selectedCode = state.selectedCode === feature.properties.c ? null : feature.properties.c;
    state.hoveredRegionCode = null;
    state.hoveredCode = feature.properties.c;
    syncHighlightSources();
    renderPanels();

    const metric = state.metricsByCode.get(feature.properties.c);
    if (metric) {
      popup.setLngLat(event.lngLat).setHTML(buildPopupMarkup(metric)).addTo(mapView);
    }
  });

  mapView.on("click", (event) => {
    const features = mapView.queryRenderedFeatures(event.point, { layers: ["msoa-extrusions"] });
    if (features.length) {
      return;
    }

    markUserInteracted();
    state.selectedCode = null;
    state.hoveredCode = null;
    state.hoveredRegionCode = null;
    syncHighlightSources();
    renderPanels();
    popup.remove();
  });
}

function buildRegionPopupMarkup(regionMetric) {
  return `
    <p class="popup-kicker">Regional average</p>
    <h4>${escapeHtml(regionMetric.name)}</h4>
    <div class="popup-metrics">
      <div>
        <span class="popup-metric-label">Prevalence</span>
        <span class="popup-metric-value">${formatPercent(regionMetric.rate)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Gap vs England</span>
        <span class="popup-metric-value">${formatPp(regionMetric.gap)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Disabled</span>
        <span class="popup-metric-value">${formatNumber(regionMetric.disabled)}</span>
      </div>
      <div>
        <span class="popup-metric-label">Population</span>
        <span class="popup-metric-value">${formatNumber(regionMetric.total)}</span>
      </div>
    </div>
  `;
}

function getRegionLabelMetricText(regionMetric) {
  return state.mode === "gap" ? formatPp(regionMetric.gap) : formatPercent(regionMetric.rate);
}

function shortRegionName(name) {
  return name === "Yorkshire and The Humber" ? "Yorkshire & Humber" : name;
}

function createRegionLabels() {
  if (!mapView || !data.regionLabels?.features) {
    return;
  }

  data.regionLabels.features.forEach((feature) => {
    const code = feature.properties.code;
    const name = feature.properties.name;
    const element = document.createElement("button");
    element.className = "region-label-marker";
    element.type = "button";
    element.innerHTML = `
      <div class="region-label-stack">
        <strong class="region-label-name">${escapeHtml(shortRegionName(name))}</strong>
        <span class="region-label-value">0%</span>
      </div>
    `;

    const marker = new maplibregl.Marker({
      element,
      anchor: "bottom",
    })
      .setLngLat(feature.geometry.coordinates)
      .addTo(mapView);

    element.addEventListener("mouseenter", () => {
      const regionMetric = state.regionMetricsByCode.get(code);
      if (!popup || !regionMetric) {
        return;
      }
      setHoveredRegionCode(code, feature.geometry.coordinates, false);
      popup.setLngLat(feature.geometry.coordinates).setHTML(buildRegionPopupMarkup(regionMetric)).addTo(mapView);
    });

    element.addEventListener("mouseleave", () => {
      state.hoveredRegionCode = null;
      syncHighlightSources();
      popup?.remove();
      renderPanels();
    });

    element.addEventListener("click", () => {
      markUserInteracted();
      state.hoveredRegionCode = code;
      syncHighlightSources();
      renderPanels();
      const bounds = regionBoundsByCode.get(code);
      if (bounds) {
        fitBoundsWithAngle(bounds, { padding: 50, maxZoom: 8.1, duration: 950 });
      }
    });

    regionColumnMarkers.set(code, {
      marker,
      element,
      value: element.querySelector(".region-label-value"),
    });
  });

  const syncVisibility = () => {
    const hidden = mapView.getZoom() > 7.35;
    regionColumnMarkers.forEach(({ marker }) => {
      marker.getElement().style.display = hidden ? "none" : "block";
    });
    syncRegionColumns(getScale());
  };

  mapView.on("zoom", syncVisibility);
  syncVisibility();
}

function syncRegionColumns(scale) {
  if (!regionColumnMarkers.size) {
    return;
  }

  state.regionMetrics.forEach((region) => {
    const markerRecord = regionColumnMarkers.get(region.code);
    if (!markerRecord) {
      return;
    }

    const color = scale.colorFor(state.mode === "gap" ? region.gap : region.rate);
    markerRecord.element.style.setProperty("--label-color", color);
    markerRecord.value.textContent = getRegionLabelMetricText(region);
    markerRecord.element.setAttribute(
      "aria-label",
      `${region.name}: ${formatPercent(region.rate)} prevalence, ${formatPp(region.gap)} vs England`
    );
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

  dom.rotateLeft.addEventListener("click", () => {
    rotateMap(-30);
  });

  dom.rotateRight.addEventListener("click", () => {
    rotateMap(30);
  });

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

  const scale = getScale();
  updateRuntimeFeatures(scale);
  updateRuntimeRegionFeatures(scale);
  mapView.getSource("msoas").setData(runtimeMsoas);
  mapView.getSource("regions").setData(runtimeRegions);
  renderLegend(scale);
  syncRegionColumns(scale);
  syncHighlightSources();
}

function update() {
  if (!state.selectedCode) {
    state.hoveredCode = null;
  }

  computeMetrics();
  renderModeButtons();
  renderAgeChips();
  renderPanels();
  updateMap();
}

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

function updateRuntimeRegionFeatures(scale) {
  runtimeRegions.features.forEach((feature) => {
    const metric = state.regionMetricsByCode.get(feature.properties.code);
    const renderValue = state.mode === "gap" ? metric?.gap : metric?.rate;
    const height =
      state.mode === "gap"
        ? Number.isFinite(metric?.gap)
          ? Math.max(Math.abs(metric.gap) * 150000, 1000)
          : 0
        : Number.isFinite(metric?.rate)
          ? Math.max(metric.rate * 32000, 1400)
          : 0;

    feature.properties.fill = scale.colorFor(renderValue);
    feature.properties.height = Number(height.toFixed(2));
    feature.properties.rateValue = Number.isFinite(metric?.rate) ? Number(metric.rate.toFixed(6)) : null;
    feature.properties.gapValue = Number.isFinite(metric?.gap) ? Number(metric.gap.toFixed(6)) : null;
    feature.properties.renderValue = Number.isFinite(renderValue) ? Number(renderValue.toFixed(6)) : null;
  });
}

try {
  if (mapView) {
    mapView.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapView.scrollZoom.setWheelZoomRate(1 / 960);
    mapView.scrollZoom.setZoomRate(1 / 140);
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
  renderModeButtons();
  renderAgeChips();
  renderPanels();
  renderLegend(getScale());

  if (!mapView) {
    dom.heightNote.innerHTML =
      "<strong>3D unavailable</strong><span>This browser could not start the WebGL map, but the age filters and inequality figures are still available.</span>";
  } else {
    mapView.once("load", () => {
      fitBoundsWithAngle(englandBounds, {
        padding: { top: 56, right: 56, bottom: 56, left: 56 },
        maxZoom: DEFAULT_VIEW.zoom,
        duration: 0,
      });
      queueInitialStoryStart();
    });
  }
} catch (error) {
  console.error(error);
  dom.heightNote.innerHTML =
    "<strong>Map error</strong><span>The 3D map could not finish loading in this browser session.</span>";
  throw error;
}
