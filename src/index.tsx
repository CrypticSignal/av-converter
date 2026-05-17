import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import './index.css';

async function callLoggingEndpoint() {
  let deviceModel = 'Unknown Platform';
  let devicePlatform = 'Unknown Platform';

  // @ts-ignore
  if (navigator.userAgentData) {
    try {
      // @ts-ignore
      // User-Agent Client Hints API
      const highEntropy = await navigator.userAgentData.getHighEntropyValues(["model", "platform"]);
      
      deviceModel = highEntropy.model ? highEntropy.model : 'Unknown Device';
      devicePlatform = highEntropy.platform ? highEntropy.platform : 'Unknown Platform'
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
      deviceModel,
      devicePlatform
    })
  }).catch(err => console.error('Logging failed:', err));
}

callLoggingEndpoint();

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>
);