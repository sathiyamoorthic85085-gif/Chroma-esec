import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  Map as GoogleMap,
  type MapMouseEvent,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin, Navigation, Search } from 'lucide-react';
import { api } from '../lib/api';

let cachedPublicMapsKey: string | null = null;
let pendingKeyPromise: Promise<string> | null = null;

async function resolvePublicMapsApiKey(): Promise<string> {
  const viteKey = (import.meta.env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();
  if (viteKey) return viteKey;
  if (cachedPublicMapsKey !== null) return cachedPublicMapsKey;
  if (!pendingKeyPromise) {
    pendingKeyPromise = api
      .getPublicConfig()
      .then((res) => {
        cachedPublicMapsKey = res.googleMapsApiKey || '';
        return cachedPublicMapsKey;
      })
      .catch(() => {
        cachedPublicMapsKey = '';
        return '';
      });
  }
  return pendingKeyPromise;
}

const DEFAULT_CAMPUS_CENTER = { lat: 11.2738, lng: 77.6062 };

interface ClassroomMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters?: number;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  label?: string;
  readOnly?: boolean;
  height?: string;
  showSearch?: boolean;
  onSelectLocation?: (coords: { lat: number; lng: number; label?: string }) => void;
}

interface GoogleMapsCircleLike {
  setMap: (map: unknown | null) => void;
}

interface GoogleMapsGlobal {
  maps?: {
    Circle?: new (opts: Record<string, unknown>) => GoogleMapsCircleLike;
  };
}

interface PlaceSuggestionLike {
  placePrediction?: {
    text: { text: string };
    toPlace: () => {
      displayName?: string;
      formattedAddress?: string;
      location?: { lat: (() => number) | number; lng: (() => number) | number };
      fetchFields: (opts: { fields: string[] }) => Promise<unknown>;
    };
  };
}

interface PlacesLibraryLike {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (req: {
      input: string;
      sessionToken: unknown;
    }) => Promise<{ suggestions?: PlaceSuggestionLike[] }>;
  };
}

function GeofenceCircle({
  center,
  radiusMeters,
}: {
  center: { lat: number; lng: number } | null;
  radiusMeters: number;
}) {
  const map = useMap();

  useEffect(() => {
    const g = (globalThis as unknown as { google?: GoogleMapsGlobal }).google;
    if (!map || !center || !g?.maps?.Circle) {
      return;
    }
    const circle = new g.maps.Circle({
      map,
      center,
      radius: Math.max(20, radiusMeters),
      strokeColor: '#4F46E5',
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: '#6366F1',
      fillOpacity: 0.16,
      clickable: false,
    });
    return () => {
      circle.setMap(null);
    };
  }, [map, center?.lat, center?.lng, radiusMeters]);

  return null;
}

function PlacesSearchBar({
  onSelectPlace,
}: {
  onSelectPlace: (coords: { lat: number; lng: number; label: string }) => void;
}) {
  const map = useMap();
  const placesLib = useMapsLibrary('places') as unknown as PlacesLibraryLike | null;
  const sessionTokenRef = useRef<unknown>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestionLike[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!placesLib || !query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(res.suggestions ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [placesLib, query]);

  const handleChooseSuggestion = async (suggestion: PlaceSuggestionLike) => {
    if (!suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      const loc = place.location;
      if (loc) {
        const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
        const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
        const placeLabel =
          place.displayName ||
          place.formattedAddress ||
          suggestion.placePrediction.text.text ||
          'Selected Map Location';
        onSelectPlace({ lat, lng, label: placeLabel });
        if (map) {
          map.panTo({ lat, lng });
          map.setZoom(17);
        }
      }
    } finally {
      sessionTokenRef.current = null;
      setSuggestions([]);
      setQuery('');
    }
  };

  return (
    <div className="relative z-20">
      <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 shadow-xs">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search campus block, classroom, or landmark..."
          className="w-full text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />}
      </div>
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100 z-30">
          {suggestions.map((item, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handleChooseSuggestion(item)}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span className="truncate">{item.placePrediction?.text.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CameraCenterSync({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (map && latitude !== null && longitude !== null) {
      map.panTo({ lat: latitude, lng: longitude });
    }
  }, [map, latitude, longitude]);
  return null;
}

export function ClassroomMapPicker({
  latitude,
  longitude,
  radiusMeters = 200,
  currentLatitude = null,
  currentLongitude = null,
  label = 'Target Pin Location',
  readOnly = false,
  height = '280px',
  showSearch = !readOnly,
  onSelectLocation,
}: ClassroomMapPickerProps) {
  const [apiKey, setApiKey] = useState<string>('');
  const [loadingKey, setLoadingKey] = useState(true);
  const [locating, setLocating] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    resolvePublicMapsApiKey().then((k) => {
      if (!active) return;
      setApiKey(k);
      setLoadingKey(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const center = useMemo(() => {
    if (latitude !== null && longitude !== null) {
      return { lat: latitude, lng: longitude };
    }
    if (currentLatitude !== null && currentLongitude !== null) {
      return { lat: currentLatitude, lng: currentLongitude };
    }
    return DEFAULT_CAMPUS_CENTER;
  }, [latitude, longitude, currentLatitude, currentLongitude]);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      if (readOnly || !onSelectLocation) return;
      const latLng = ev.detail?.latLng;
      if (!latLng) return;
      onSelectLocation({
        lat: Number(latLng.lat.toFixed(6)),
        lng: Number(latLng.lng.toFixed(6)),
      });
    },
    [readOnly, onSelectLocation]
  );

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        onSelectLocation?.({ lat, lng });
      },
      (err) => {
        setLocating(false);
        setGeoError(err.message || 'Unable to detect GPS coordinates.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Interactive click-to-pin coordinate canvas fallback when Maps JS key isn't active yet
  const handleFallbackCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !onSelectLocation) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = 0.5 - (e.clientY - rect.top) / rect.height;
    // Span ~0.008 degrees (~880m) across canvas for precise classroom/campus pin clicking
    const lat = Number((center.lat + relY * 0.008).toFixed(6));
    const lng = Number((center.lng + relX * 0.008).toFixed(6));
    onSelectLocation({ lat, lng });
  };

  if (loadingKey) {
    return (
      <div
        className="w-full rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-500"
        style={{ height }}
      >
        <Loader2 className="w-4 h-4 animate-spin mr-2 text-indigo-600" />
        Loading interactive map...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-indigo-600" />
          <span>
            {readOnly
              ? `${label} (${center.lat.toFixed(5)}, ${center.lng.toFixed(5)})`
              : 'Click anywhere on the map to set the target pin location'}
          </span>
        </div>
        {!readOnly && onSelectLocation && (
          <button
            type="button"
            onClick={handleLocateMe}
            disabled={locating}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-semibold transition-colors disabled:opacity-60"
          >
            {locating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Crosshair className="w-3 h-3" />
            )}
            Use My GPS
          </button>
        )}
      </div>

      {geoError && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
          {geoError}
        </p>
      )}

      {apiKey && !mapFailed ? (
        <APIProvider
          apiKey={apiKey}
          language="en"
          region="IN"
          onError={() => setMapFailed(true)}
        >
          <div className="space-y-2">
            {showSearch && onSelectLocation && (
              <PlacesSearchBar
                onSelectPlace={(coords) => {
                  onSelectLocation(coords);
                }}
              />
            )}
            <div
              className="w-full rounded-xl overflow-hidden border border-slate-300 shadow-xs relative"
              style={{ height }}
            >
              <GoogleMap
                defaultCenter={center}
                defaultZoom={17}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                disableDefaultUI={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                onClick={handleMapClick}
                style={{ width: '100%', height: '100%' }}
              >
                <CameraCenterSync latitude={latitude} longitude={longitude} />
                {latitude !== null && longitude !== null && (
                  <>
                    <AdvancedMarker position={{ lat: latitude, lng: longitude }} title={label}>
                      <Pin background="#4F46E5" glyphColor="#FFFFFF" borderColor="#312E81" />
                    </AdvancedMarker>
                    <GeofenceCircle
                      center={{ lat: latitude, lng: longitude }}
                      radiusMeters={radiusMeters}
                    />
                  </>
                )}
                {currentLatitude !== null && currentLongitude !== null && (
                  <AdvancedMarker
                    position={{ lat: currentLatitude, lng: currentLongitude }}
                    title="Your Current Live GPS Location"
                  >
                    <Pin background="#059669" glyphColor="#FFFFFF" borderColor="#065F46" />
                  </AdvancedMarker>
                )}
              </GoogleMap>
            </div>
          </div>
        </APIProvider>
      ) : (
        <div
          onClick={handleFallbackCanvasClick}
          className={`relative w-full rounded-xl border border-indigo-200 overflow-hidden select-none bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white ${
            readOnly ? 'cursor-default' : 'cursor-crosshair'
          }`}
          style={{ height }}
          role={!readOnly ? 'button' : undefined}
          aria-label="Interactive coordinate map picker"
        >
          <svg
            viewBox="0 0 400 240"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
          >
            <defs>
              <pattern id="gridLines" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#818CF8" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect width="400" height="240" fill="url(#gridLines)" />
          </svg>

          {/* Geofence ring */}
          {latitude !== null && longitude !== null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-28 h-28 rounded-full border-2 border-indigo-400/70 bg-indigo-500/20 flex items-center justify-center">
                <div className="flex flex-col items-center">
                  <MapPin className="w-6 h-6 text-amber-300 drop-shadow" />
                  <span className="mt-1 px-2 py-0.5 rounded bg-slate-950/85 text-[10px] font-mono text-amber-200">
                    {latitude.toFixed(5)}, {longitude.toFixed(5)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {currentLatitude !== null && currentLongitude !== null && (
            <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/40 text-[10px] font-mono text-emerald-200 flex items-center gap-1.5">
              <Navigation className="w-3 h-3 text-emerald-400" />
              Live Device GPS: {currentLatitude.toFixed(5)}, {currentLongitude.toFixed(5)}
            </div>
          )}

          <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-white/15 text-[10px] font-medium text-indigo-100">
              {readOnly ? label : 'Click anywhere inside the map grid to place target pin'}
            </span>
            <span className="px-2 py-1 rounded-lg bg-indigo-600/80 text-[10px] font-mono text-white">
              Radius {radiusMeters}m
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
