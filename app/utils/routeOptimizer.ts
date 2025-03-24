import mapboxgl from "mapbox-gl";

interface Location {
  address: string;
  lat: number;
  lng: number;
}

interface OptimizedRoute {
  coordinates: [number, number][];
  order: number[];
  distance: number;
  duration: number;
}

interface MapboxDirectionsResponse {
  routes: Array<{
    distance: number;
    duration: number;
    geometry: {
      coordinates: [number, number][];
      type: string;
    };
  }>;
}

// Calculate distance between two points using Haversine formula (in miles)
function calculateDistance(point1: Location, point2: Location): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const dLon = ((point2.lng - point1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((point1.lat * Math.PI) / 180) *
      Math.cos((point2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get route directions from Mapbox
export async function getRouteDirections(
  coordinates: [number, number][]
): Promise<MapboxDirectionsResponse> {
  const coordinatesStr = coordinates.map((coord) => coord.join(",")).join(";");
  const response = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinatesStr}?geometries=geojson&overview=full&annotations=distance,duration,speed,congestion&access_token=${mapboxgl.accessToken}`
  );
  return response.json();
}

// Optimize route using nearest neighbor with 2-opt improvement and traffic consideration
export function optimizeRoute(
  startLocation: Location,
  stops: Location[],
  endLocation?: Location
): OptimizedRoute {
  // Add start location and optional end location
  const allPoints = endLocation
    ? [startLocation, ...stops, endLocation]
    : [startLocation, ...stops, startLocation];
  const n = allPoints.length;

  // Create distance and time matrices
  const distanceMatrix: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));
  const timeMatrix: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));

  // Fill distance and time matrices
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const distance = calculateDistance(allPoints[i], allPoints[j]);
        distanceMatrix[i][j] = distance;

        // Estimate time with traffic factor
        // Base speed of 30 mph, adjusted by time of day and typical congestion
        const hour = new Date().getHours();
        let trafficFactor = 1;

        // Rush hour adjustment (7-10 AM and 4-7 PM)
        if ((hour >= 7 && hour <= 10) || (hour >= 16 && hour <= 19)) {
          trafficFactor = 1.5; // 50% slower during rush hour
        }
        // Night time adjustment (10 PM - 5 AM)
        else if (hour >= 22 || hour <= 5) {
          trafficFactor = 0.8; // 20% faster during night
        }

        // Calculate estimated time in minutes
        timeMatrix[i][j] = (distance / 30) * 60 * trafficFactor;
      }
    }
  }

  // Nearest neighbor algorithm with traffic consideration
  function findNearestNeighborRoute(): number[] {
    const route: number[] = [0]; // Start with the first point
    const unvisited = new Set(Array.from({ length: n - 2 }, (_, i) => i + 1));

    while (unvisited.size > 0) {
      const current = route[route.length - 1];
      let nearest = -1;
      let minScore = Infinity;

      for (const next of unvisited) {
        // Combined score of distance and time (weighted)
        const distanceScore = distanceMatrix[current][next];
        const timeScore = timeMatrix[current][next];
        const combinedScore = distanceScore * 0.3 + timeScore * 0.7; // Weight time more heavily than distance

        if (combinedScore < minScore) {
          minScore = combinedScore;
          nearest = next;
        }
      }

      route.push(nearest);
      unvisited.delete(nearest);
    }

    route.push(n - 1); // Add end point
    return route;
  }

  // 2-opt improvement considering both distance and time
  function improve2Opt(route: number[]): number[] {
    let improved = true;
    let bestScore = calculateRouteScore(route);

    while (improved) {
      improved = false;
      for (let i = 1; i < route.length - 2; i++) {
        for (let j = i + 1; j < route.length - 1; j++) {
          const newRoute = twoOptSwap(route, i, j);
          const newScore = calculateRouteScore(newRoute);

          if (newScore < bestScore) {
            route = newRoute;
            bestScore = newScore;
            improved = true;
          }
        }
      }
    }
    return route;
  }

  // Calculate combined route score (distance and time)
  function calculateRouteScore(route: number[]): number {
    let distance = 0;
    let time = 0;
    for (let i = 0; i < route.length - 1; i++) {
      distance += distanceMatrix[route[i]][route[i + 1]];
      time += timeMatrix[route[i]][route[i + 1]];
    }
    return distance * 0.3 + time * 0.7; // Weight time more heavily than distance
  }

  // Get initial route using nearest neighbor
  let bestRoute = findNearestNeighborRoute();

  // Improve route using 2-opt
  bestRoute = improve2Opt(bestRoute);

  // Calculate final distance
  const finalDistance = bestRoute.reduce((total, current, i) => {
    if (i === 0) return 0;
    return total + distanceMatrix[bestRoute[i - 1]][current];
  }, 0);

  return {
    coordinates: bestRoute.map((i) => [allPoints[i].lng, allPoints[i].lat]),
    order: bestRoute,
    distance: finalDistance,
    duration: 0, // Will be updated with actual duration from Mapbox
  };
}

// Perform 2-opt swap
function twoOptSwap(route: number[], i: number, j: number): number[] {
  const newRoute = [...route];
  while (i < j) {
    [newRoute[i], newRoute[j]] = [newRoute[j], newRoute[i]];
    i++;
    j--;
  }
  return newRoute;
}

interface CustomMapboxImage {
  width: number;
  height: number;
  data: Uint8Array;
  context: CanvasRenderingContext2D | null;
  onAdd(): void;
  render(): boolean;
}

interface MapboxCustomImage {
  width: number;
  height: number;
  data: Uint8Array;
  onAdd?(): void;
  render?(): boolean;
}

// Draw route on map with enhanced styling
export function drawRoute(
  map: mapboxgl.Map,
  routeData: MapboxDirectionsResponse["routes"][0]
) {
  const geojsonData = {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: routeData.geometry.coordinates,
    },
  };

  if (!map.getSource("route")) {
    map.addSource("route", {
      type: "geojson",
      data: geojsonData,
    });

    map.addLayer({
      id: "route",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#3b82f6",
        "line-width": 4,
        "line-opacity": 0.8,
      },
    });

    // Add direction arrows
    map.addLayer({
      id: "route-arrows",
      type: "symbol",
      source: "route",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 100,
        "icon-image": "arrow",
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-padding": 0,
      },
    });

    // Create and add the arrow icon
    if (!map.hasImage("arrow")) {
      const size = 24;
      const pulsingDot: CustomMapboxImage = {
        width: size,
        height: size,
        data: new Uint8Array(size * size * 4),
        context: null,
        onAdd: function () {
          const canvas = document.createElement("canvas");
          canvas.width = this.width;
          canvas.height = this.height;
          this.context = canvas.getContext("2d")!;
        },
        render: function () {
          const ctx = this.context;
          if (!ctx) return false;

          ctx.clearRect(0, 0, this.width, this.height);

          // Draw arrow
          ctx.beginPath();
          ctx.moveTo(this.width / 2, 0);
          ctx.lineTo(this.width, this.height / 2);
          ctx.lineTo(this.width / 2, this.height);
          ctx.lineTo(0, this.height / 2);
          ctx.closePath();

          // Fill with gradient
          const gradient = ctx.createLinearGradient(0, 0, this.width, 0);
          gradient.addColorStop(0, "#10B981");
          gradient.addColorStop(1, "#3B82F6");
          ctx.fillStyle = gradient;
          ctx.fill();

          return true;
        },
      };

      map.addImage("arrow", pulsingDot as unknown as MapboxCustomImage);
    }
  } else {
    (map.getSource("route") as mapboxgl.GeoJSONSource).setData(geojsonData);
  }
}
