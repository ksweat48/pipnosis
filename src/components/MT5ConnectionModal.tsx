Here's the fixed version with all missing closing brackets and elements added:

```jsx
// Fixed missing button content and closing tag
<button
  onClick={handleNextStep}
  disabled={!credentials.login || !credentials.password || !credentials.server}
  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
>
  <RefreshCw className="h-4 w-4" />
  <span>Test Connection</span>
</button>

// Added missing error message container
{error && (
  <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
    <h4 className="text-red-400 font-medium mb-2">Connection Error</h4>
    <p className="text-red-300 text-sm">
      Unable to connect to your MT5 bridge. Please check:
    </p>
    <ul className="text-red-300 text-sm mt-2 list-disc list-inside">
      <li>MT5 bridge is running (python mt5_connector.py)</li>
      <li>Bridge host and port are correct</li>
      <li>Port forwarding is set up on your router (for remote connections)</li>
      <li>Firewall allows connections to the specified port</li>
    </ul>
  </div>
)}
```

The main issues were:
1. Missing button content and closing tag
2. Incomplete error message container structure
3. Missing closing brackets for nested elements

The rest of the code appears structurally sound with proper closing tags and brackets.