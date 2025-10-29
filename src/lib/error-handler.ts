class ErrorHandler {
  isWebContainerError(error: any): boolean {
    if (!error) return false;
    const message = error.message || error.toString();
    return message.includes('WebContainer') ||
           message.includes('ERR_NETWORK_CHANGED') ||
           message.includes('ERR_CONNECTION_RESET');
  }

  isMetaApiError(error: any): boolean {
    if (!error) return false;
    const message = error.message || error.toString();
    return message.includes('mt-provisioning-api') ||
           message.includes('agiliumtrade.ai') ||
           message.includes('MetaApi');
  }

  handleWebContainerTimeout(error: any): void {
    console.warn('WebContainer timeout (non-critical):', error?.message);
  }

  handleMetaApiError(error: any): void {
    console.warn('MetaApi error (handled):', error?.message);
  }

  handleNetworkError(error: any): void {
    console.warn('Network error (handled):', error?.message);
  }

  handleResourcePreloadWarning(filename: string): void {
    console.warn('Resource preload warning:', filename);
  }
}

export const errorHandler = new ErrorHandler();
