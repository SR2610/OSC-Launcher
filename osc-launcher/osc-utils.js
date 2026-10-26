// OSC Utility functions: Pattern Matching & Security Whitelisting

/**
 * Matches an incoming OSC address against an OSC pattern
 * Supporting standard OSC 1.0 wildcards:
 * - '*' matches any sequence of characters except '/'
 * - '?' matches any single character except '/'
 * - '{a,b}' matches any of the comma-separated sub-patterns
 * - '[0-9]' matches character ranges
 * - '[!0-9]' matches negated character ranges
 */
function matchesOscPattern(pattern, address) {
  if (!pattern || !address) return false;
  if (pattern === address) return true;

  try {
    let reStr = "^";
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === "*") {
        reStr += "[^/]*";
      } else if (c === "?") {
        reStr += "[^/]";
      } else if (c === "{") {
        const end = pattern.indexOf("}", i);
        if (end !== -1) {
          const parts = pattern.slice(i + 1, end).split(",");
          reStr += "(" + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")";
          i = end;
        } else {
          reStr += "\\{";
        }
      } else if (c === "[" && pattern.indexOf("]", i) !== -1) {
        const end = pattern.indexOf("]", i);
        const charSet = pattern.slice(i + 1, end);
        if (charSet.startsWith("!")) {
          reStr += "[^" + charSet.slice(1) + "]";
        } else {
          reStr += "[" + charSet + "]";
        }
        i = end;
      } else if ("()+|^$.#\\".includes(c)) {
        reStr += "\\" + c;
      } else {
        reStr += c;
      }
      i++;
    }
    reStr += "$";
    return new RegExp(reStr).test(address);
  } catch {
    return pattern === address;
  }
}

/**
 * Checks if a remote IP address is authorized under an allowed IPs string
 * Empty or whitespace allowedIps string indicates all addresses are allowed.
 */
function isIpAllowed(remoteAddress, allowedIpsStr) {
  if (!remoteAddress) return false;
  if (!allowedIpsStr || !allowedIpsStr.trim()) return true;
  const list = allowedIpsStr.split(",").map((s) => s.trim());
  return list.includes(remoteAddress);
}

module.exports = {
  matchesOscPattern,
  isIpAllowed,
};
