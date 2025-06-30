/** Route pattern matching utilities */
export type RouteParams = Record<string, string>;

/** Route match result with specificity score for precedence */
type RouteMatch = {
  match: boolean;
  params: RouteParams;
  specificity: number; // Higher = more specific
};

/** Check if a path pattern matches the request path and extract parameters */
const matchRoute = (pattern: string, path: string): RouteMatch => {
  if (pattern === "/" && path === "/") {
    return { match: true, params: {}, specificity: 1000 };
  }

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  const params: RouteParams = {};
  let specificity = 0;

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith("[[") && patternPart.endsWith("]]")) {
      // Catchall parameter - captures remaining segments
      const paramName = patternPart.slice(2, -2);
      params[paramName] = pathParts.slice(i).join("/") || "";
      return { match: true, params, specificity: specificity + 1 };
    }

    if (patternPart.startsWith("[") && patternPart.endsWith("]")) {
      // Regular parameter
      if (!pathPart) return { match: false, params: {}, specificity: 0 };
      params[patternPart.slice(1, -1)] = pathPart;
      specificity += 10;
    } else if (patternPart === pathPart) {
      // Literal segment
      specificity += 100;
    } else {
      // No match
      return { match: false, params: {}, specificity: 0 };
    }
  }

  // Check if all path parts consumed (no catchall handled above)
  return pathParts.length === patternParts.length
    ? { match: true, params, specificity }
    : { match: false, params: {}, specificity: 0 };
};

/** Find best matching handler from a collection */
export const findBestMatch = <T>(
  handlers: Map<string, T>,
  path: string,
): { handler: T; params: RouteParams } | null => {
  // Try exact match first
  const exactMatch = handlers.get(path);
  if (exactMatch) return { handler: exactMatch, params: {} };

  // Try pattern matching
  let bestMatch: { handler: T; params: RouteParams } | null = null;
  let bestSpecificity = 0;

  for (const [pattern, handler] of handlers) {
    const { match, params, specificity } = matchRoute(pattern, path);
    if (match && specificity > bestSpecificity) {
      bestMatch = { handler, params };
      bestSpecificity = specificity;
    }
  }

  return bestMatch;
};
