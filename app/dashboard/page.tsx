"use client";

import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  optimizeRoute,
  getRouteDirections,
  drawRoute,
} from "../utils/routeOptimizer";
import RouteSummary from "../components/RouteSummary";

// Set Mapbox access token
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

interface Location {
  address: string;
  lat: number;
  lng: number;
}

interface Stop {
  address: string;
  lat: number;
  lng: number;
}

interface Suggestion {
  place_name: string;
  center: [number, number];
}

interface MapboxFeature {
  place_name: string;
  center: [number, number];
}

interface RouteSummaryData {
  distance: number;
  duration: number;
  stops: Array<{
    address: string;
    order: number;
  }>;
}

const DashboardPage = () => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const startInputRef = useRef<HTMLInputElement>(null);

  const [inputValues, setInputValues] = useState({
    start: "",
    end: "",
    stops: [""],
  });

  const [startLocation, setStartLocation] = useState<Location>({
    address: "",
    lat: 37.7749,
    lng: -122.4194,
  });
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [stops, setStops] = useState<Stop[]>([{ address: "", lat: 0, lng: 0 }]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] =
    useState<number>(-1);
  const [activeSuggestionInput, setActiveSuggestionInput] = useState<
    "start" | "end" | number | null
  >(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummaryData | null>(
    null
  );

  // Initialize map
  useEffect(() => {
    if (!map.current && mapContainer.current) {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [startLocation.lng, startLocation.lat],
        zoom: 11,
      });

      // Add navigation controls
      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

      // Add geolocate control
      const geolocateControl = new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: false,
        showUserHeading: true,
      });
      map.current.addControl(geolocateControl, "top-right");

      // Add click handler for map
      map.current.on("click", async (e) => {
        const { lng, lat } = e.lngLat;
        const address = await reverseGeocode(lat, lng);

        // If no start location is set, set it as start
        if (!startLocation.lat || !startLocation.lng) {
          setStartLocation({ address, lat, lng });
          setInputValues((prev) => ({ ...prev, start: address }));
        } else {
          // Add as a new stop
          const newStop = { address, lat, lng };
          setStops((prev) => [...prev, newStop]);
          setInputValues((prev) => ({
            ...prev,
            stops: [...prev.stops, address],
          }));
        }
      });
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [startLocation.lat, startLocation.lng]);

  // Update markers with improved styling and information
  const updateMarkers = () => {
    const currentMap = map.current;
    if (!currentMap) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    // Add start location marker with custom element
    if (startLocation.lat && startLocation.lng) {
      const startElement = document.createElement("div");
      startElement.className =
        "flex items-center justify-center w-8 h-8 rounded-full bg-red-500 border-2 border-white shadow-lg";
      startElement.innerHTML = '<span class="text-white font-bold">S</span>';

      const startMarker = new mapboxgl.Marker({
        element: startElement,
        anchor: "center",
      })
        .setLngLat([startLocation.lng, startLocation.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
              <div class="p-2">
                <div class="font-bold text-red-600 mb-1">Start Point</div>
                <div class="text-sm">${startLocation.address}</div>
              </div>
            `)
        )
        .addTo(currentMap);
      markersRef.current.start = startMarker;
    }

    // Add stop markers with custom elements
    stops.forEach((stop, index) => {
      if (stop.lat && stop.lng) {
        const stopElement = document.createElement("div");
        stopElement.className =
          "flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 border-2 border-white shadow-lg";
        stopElement.innerHTML = `<span class="text-white font-bold">${
          index + 1
        }</span>`;

        const marker = new mapboxgl.Marker({
          element: stopElement,
          anchor: "center",
        })
          .setLngLat([stop.lng, stop.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(`
                <div class="p-2">
                  <div class="font-bold text-blue-600 mb-1">Stop ${
                    index + 1
                  }</div>
                  <div class="text-sm">${stop.address}</div>
                </div>
              `)
          )
          .addTo(currentMap);
        markersRef.current[`stop-${index}`] = marker;
      }
    });
  };

  // Update markers whenever locations change
  useEffect(() => {
    updateMarkers();
  }, [startLocation, stops]);

  // Add this new useEffect for autofocus
  useEffect(() => {
    if (startInputRef.current) {
      startInputRef.current.focus();
    }
  }, []);

  // Function to get current location
  const getCurrentLocation = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by your browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      });
    });
  };

  // Function to reverse geocode coordinates using Mapbox
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxgl.accessToken}`
      );
      const data = await response.json();
      return data.features[0].place_name || "Unknown location";
    } catch (error) {
      console.error("Error reverse geocoding:", error);
      return "Unknown location";
    }
  };

  // Function to handle using current location
  const handleUseCurrentLocation = async (
    type: "start" | "end" | "stop",
    index?: number
  ) => {
    try {
      setIsGettingLocation(true);
      const position = await getCurrentLocation();
      const { latitude: lat, longitude: lng } = position.coords;
      const address = await reverseGeocode(lat, lng);

      if (type === "start") {
        setStartLocation({ address, lat, lng });
        map.current?.flyTo({
          center: [lng, lat],
          zoom: 13,
        });
      } else if (type === "end") {
        setEndLocation({ address, lat, lng });
        map.current?.flyTo({
          center: [lng, lat],
          zoom: 13,
        });
      } else if (type === "stop" && typeof index === "number") {
        const newStops = [...stops];
        newStops[index] = { address, lat, lng };
        setStops(newStops);
      }
    } catch (error) {
      console.error("Error getting current location:", error);
      alert(
        "Could not get your current location. Please make sure you've granted location access."
      );
    } finally {
      setIsGettingLocation(false);
    }
  };

  // Function to search addresses and get suggestions
  const searchAddressWithSuggestions = async (
    query: string
  ): Promise<Suggestion[]> => {
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          query
        )}.json?access_token=${
          mapboxgl.accessToken
        }&types=address,place,locality,neighborhood`
      );
      const data = await response.json();
      return data.features.map((feature: MapboxFeature) => ({
        place_name: feature.place_name,
        center: feature.center,
      }));
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      return [];
    }
  };

  const handleStartLocationChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    setInputValues((prev) => ({ ...prev, start: value }));
    setActiveSuggestionInput("start");
    setActiveSuggestionIndex(-1);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddressWithSuggestions(value);
        setSuggestions(suggestions);
      }, 300);
    } else {
      setSuggestions([]);
    }
  };

  const handleEndLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValues((prev) => ({ ...prev, end: value }));
    setActiveSuggestionInput("end");
    setActiveSuggestionIndex(-1);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddressWithSuggestions(value);
        setSuggestions(suggestions);
      }, 300);
    } else {
      setSuggestions([]);
    }
  };

  const handleStopChange = (index: number, value: string) => {
    setInputValues((prev) => ({
      ...prev,
      stops: prev.stops.map((stop, i) => (i === index ? value : stop)),
    }));
    setActiveSuggestionInput(index);
    setActiveSuggestionIndex(-1);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        const suggestions = await searchAddressWithSuggestions(value);
        setSuggestions(suggestions);
      }, 300);
    } else {
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = async (
    suggestion: Suggestion,
    isStart: boolean,
    stopIndex?: number,
    isEnd?: boolean
  ) => {
    const [lng, lat] = suggestion.center;
    // Get the exact address from reverse geocoding to ensure accuracy
    const accurateAddress = await reverseGeocode(lat, lng);

    if (isStart) {
      setInputValues((prev) => ({ ...prev, start: accurateAddress }));
      setStartLocation({
        address: accurateAddress,
        lat,
        lng,
      });
    } else if (typeof stopIndex === "number") {
      setInputValues((prev) => ({
        ...prev,
        stops: prev.stops.map((stop, i) =>
          i === stopIndex ? accurateAddress : stop
        ),
      }));
      setStops((prevStops) => {
        const newStops = [...prevStops];
        newStops[stopIndex] = {
          address: accurateAddress,
          lat,
          lng,
        };
        return newStops;
      });
    } else if (isEnd) {
      setEndLocation({
        address: accurateAddress,
        lat,
        lng,
      });
    }

    map.current?.flyTo({
      center: [lng, lat],
      zoom: 13,
      duration: 1500,
      essential: true,
    });

    setSuggestions([]);
    setActiveSuggestionInput(null);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    isStart: boolean,
    stopIndex?: number
  ) => {
    if (!suggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestionIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter" && activeSuggestionIndex >= 0) {
      e.preventDefault();
      handleSuggestionClick(
        suggestions[activeSuggestionIndex],
        isStart,
        stopIndex
      );
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setActiveSuggestionInput(null);
    }
  };

  // Add click outside handler to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".location-input-container")) {
        setSuggestions([]);
        setActiveSuggestionInput(null);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleAddStop = () => {
    setStops((prev) => [...prev, { address: "", lat: 0, lng: 0 }]);
    setInputValues((prev) => ({ ...prev, stops: [...prev.stops, ""] }));
  };

  const handleRemoveStop = (index: number) => {
    if (stops.length > 1) {
      setStops((prev) => prev.filter((_, i) => i !== index));
      setInputValues((prev) => ({
        ...prev,
        stops: prev.stops.filter((_, i) => i !== index),
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const currentMap = map.current;
      if (!currentMap) {
        console.error("Map not initialized");
        return;
      }

      // Filter out stops with invalid coordinates
      const validStops = stops.filter(
        (stop) => stop.lat !== 0 && stop.lng !== 0 && stop.address.trim() !== ""
      );

      if (validStops.length === 0) {
        alert("Please add at least one valid stop");
        return;
      }

      // Optimize the route
      const optimizedRoute = optimizeRoute(
        startLocation,
        validStops,
        endLocation || undefined
      );

      // Get detailed route directions from Mapbox
      const routeDirections = await getRouteDirections(
        optimizedRoute.coordinates
      );

      // Draw the route on the map
      if (routeDirections.routes && routeDirections.routes[0]) {
        const route = routeDirections.routes[0];
        drawRoute(currentMap, route);

        // Clear existing markers
        Object.values(markersRef.current).forEach((marker) => marker.remove());
        markersRef.current = {};

        // Create bounds to fit all points
        const bounds = new mapboxgl.LngLatBounds();

        // Add start/end marker
        const startElement = document.createElement("div");
        startElement.className =
          "flex items-center justify-center w-8 h-8 rounded-full bg-red-500 border-2 border-white shadow-lg";
        startElement.innerHTML = '<span class="text-white font-bold">S</span>';

        const startMarker = new mapboxgl.Marker({
          element: startElement,
          anchor: "center",
        })
          .setLngLat([startLocation.lng, startLocation.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(`
              <div class="p-2">
                <div class="font-bold text-red-600 mb-1">Start/End Point</div>
                <div class="text-sm">${startLocation.address}</div>
              </div>
            `)
          )
          .addTo(currentMap);
        markersRef.current.start = startMarker;
        bounds.extend([startLocation.lng, startLocation.lat]);

        // Add numbered stop markers based on optimized sequence
        optimizedRoute.order.slice(1, -1).forEach((index, i) => {
          const stop = validStops[index - 1];
          const stopElement = document.createElement("div");
          stopElement.className =
            "flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 border-2 border-white shadow-lg";
          stopElement.innerHTML = `<span class="text-white font-bold">${
            i + 1
          }</span>`;

          const marker = new mapboxgl.Marker({
            element: stopElement,
            anchor: "center",
          })
            .setLngLat([stop.lng, stop.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 25 }).setHTML(`
                <div class="p-2">
                  <div class="font-bold text-blue-600 mb-1">Stop ${i + 1}</div>
                  <div class="text-sm">${stop.address}</div>
                </div>
              `)
            )
            .addTo(currentMap);
          markersRef.current[`stop-${i}`] = marker;
          bounds.extend([stop.lng, stop.lat]);
        });

        // Fit map to show all markers with padding
        currentMap.fitBounds(bounds, {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 1000,
        });

        // Update route summary with actual distance and duration
        setRouteSummary({
          distance: route.distance * 0.000621371, // Convert meters to miles
          duration: route.duration,
          stops: [
            { address: startLocation.address, order: 0 },
            ...optimizedRoute.order.slice(1, -1).map((index, i) => ({
              address: validStops[index - 1].address,
              order: i + 1,
            })),
            {
              address: startLocation.address,
              order: optimizedRoute.order.length - 1,
            },
          ],
        });
      }
    } catch (error) {
      console.error("Error optimizing route:", error);
      alert("Error optimizing route. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 dark:bg-gray-900">
      {/* Left panel */}
      <div className="w-full md:w-1/3 p-4 overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Route Planning Dashboard
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Optimize your delivery routes with real-time mapping
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Start location input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Start Location
            </label>
            <div className="mt-1 flex gap-2">
              <div className="location-input-container relative flex-1">
                <input
                  ref={startInputRef}
                  type="text"
                  value={inputValues.start}
                  onChange={handleStartLocationChange}
                  onKeyDown={(e) => handleKeyDown(e, true)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter start address"
                  required
                />
                {suggestions.length > 0 &&
                  activeSuggestionInput === "start" && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg max-h-60 overflow-auto border border-gray-200 dark:border-gray-700">
                      {suggestions.map((suggestion, index) => (
                        <div
                          key={suggestion.place_name}
                          className={`px-4 py-2 cursor-pointer text-sm text-gray-800 dark:text-gray-200 ${
                            index === activeSuggestionIndex
                              ? "bg-blue-100 dark:bg-blue-900"
                              : "hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                          onClick={() =>
                            handleSuggestionClick(suggestion, true)
                          }
                        >
                          {suggestion.place_name}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
              <button
                type="button"
                onClick={() => handleUseCurrentLocation("start")}
                disabled={isGettingLocation}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors flex-shrink-0"
                title="Use current location"
              >
                📍
              </button>
            </div>
          </div>

          {/* End location input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              End Location (Optional)
            </label>
            <div className="mt-1 flex gap-2">
              <div className="location-input-container relative flex-1">
                <input
                  type="text"
                  value={inputValues.end}
                  onChange={handleEndLocationChange}
                  onKeyDown={(e) => handleKeyDown(e, false)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter end location (optional)"
                />
                {suggestions.length > 0 && activeSuggestionInput === "end" && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg max-h-60 overflow-auto">
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className={`px-4 py-2 cursor-pointer ${
                          index === activeSuggestionIndex
                            ? "bg-blue-100 dark:bg-blue-900"
                            : "hover:bg-gray-100 dark:hover:bg-gray-700"
                        }`}
                        onClick={() =>
                          handleSuggestionClick(
                            suggestion,
                            false,
                            undefined,
                            true
                          )
                        }
                      >
                        {suggestion.place_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleUseCurrentLocation("end")}
                disabled={isGettingLocation}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors flex-shrink-0"
                title="Use current location"
              >
                📍
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Delivery Stops
            </label>
            {stops.map((stop, index) => (
              <div key={index} className="flex gap-2">
                <div className="location-input-container relative flex-1">
                  <input
                    type="text"
                    value={inputValues.stops[index]}
                    onChange={(e) => handleStopChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, false, index)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder={`Stop ${index + 1}`}
                    required
                  />
                  {suggestions.length > 0 &&
                    activeSuggestionInput === index && (
                      <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg max-h-60 overflow-auto border border-gray-200 dark:border-gray-700">
                        {suggestions.map((suggestion, suggestionIndex) => (
                          <div
                            key={suggestion.place_name}
                            className={`px-4 py-2 cursor-pointer text-sm text-gray-800 dark:text-gray-200 ${
                              suggestionIndex === activeSuggestionIndex
                                ? "bg-blue-100 dark:bg-blue-900"
                                : "hover:bg-gray-100 dark:hover:bg-gray-700"
                            }`}
                            onClick={() =>
                              handleSuggestionClick(suggestion, false, index)
                            }
                          >
                            {suggestion.place_name}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <button
                  type="button"
                  onClick={() => handleUseCurrentLocation("stop", index)}
                  disabled={isGettingLocation}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors flex-shrink-0"
                  title="Use current location"
                >
                  📍
                </button>
                {stops.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveStop(index)}
                    className="px-2 py-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex-shrink-0"
                    aria-label="Remove stop"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddStop}
            className="w-full px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-600 dark:border-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/50 transition-colors"
          >
            + Add Another Stop
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Optimizing..." : "Optimize Route"}
          </button>
        </form>
      </div>

      {/* Right panel */}
      <div className="w-full md:w-2/3 p-4 flex flex-col h-screen">
        <div className="flex-grow bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-4">
          <div
            ref={mapContainer}
            className="w-full h-full rounded-lg overflow-hidden"
          />
        </div>
        {routeSummary && (
          <div className="flex-shrink-0">
            <RouteSummary
              distance={routeSummary.distance}
              duration={routeSummary.duration}
              stops={routeSummary.stops}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
