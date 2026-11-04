// Reports a page visit to the logging service, which forwards it to Loki.
export async function logVisit(path: string) {
  let deviceModel = 'Unknown Device';
  let devicePlatform = 'Unknown Platform';

  // @ts-ignore
  if (navigator.userAgentData) {
    try {
      // @ts-ignore
      // User-Agent Client Hints API
      const highEntropy = await navigator.userAgentData.getHighEntropyValues(["model", "platform"]);

      deviceModel = highEntropy.model ? highEntropy.model : 'Unknown Device';
      devicePlatform = highEntropy.platform ? highEntropy.platform : 'Unknown Platform';
    } catch (e) {
      console.error(e);
    }
  }

  fetch('/logging/visit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path,
      deviceModel,
      devicePlatform
    })
  }).catch(err => console.error('Logging failed:', err));
}
