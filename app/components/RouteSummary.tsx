interface RouteSummaryProps {
  distance: number;
  duration?: number;
  stops: Array<{
    address: string;
    order: number;
  }>;
}

export default function RouteSummary({
  distance,
  duration,
  stops,
}: RouteSummaryProps) {
  // Format duration from seconds to hours and minutes
  const formatDuration = (seconds: number): string => {
    if (!seconds) return "Calculating...";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Route Summary
      </h3>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-300">
              Total Distance:
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {distance.toFixed(1)} miles
            </span>
          </div>

          {duration && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-300">
                Estimated Time:
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatDuration(duration)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Optimized Route Sequence:
          </h4>
          <div className="space-y-2">
            {stops.map((stop, index) => (
              <div key={index} className="flex items-center space-x-2 text-sm">
                <span
                  className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full font-medium ${
                    index === 0 || index === stops.length - 1
                      ? "bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400"
                      : "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {index === 0 ? "S" : index === stops.length - 1 ? "E" : index}
                </span>
                <span className="text-gray-600 dark:text-gray-300 truncate">
                  {stop.address}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            * Route optimized for shortest total distance
          </div>
        </div>
      </div>
    </div>
  );
}
