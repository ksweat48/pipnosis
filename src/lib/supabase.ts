// Helper function to check if a string is a valid UUID
export const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

// Helper function to check if user is a test user
export const isTestUser = (userId: string): boolean => {
  return !isValidUUID(userId) || userId.startsWith('test-') || userId.includes('mock');
};

// Check database health
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    // In a real implementation, this would check the database connection
    // For now, we'll simulate a successful connection
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch (error) {
    console.error('❌ Database health check failed with exception:', error);
    return false;
  }
};

// Test database operations
export const testDatabaseOperations = async (userId: string): Promise<{
  canRead: boolean;
  canWrite: boolean;
  policiesWork: boolean;
  error?: string;
}> => {
  // In a real implementation, this would test database operations
  // For now, we'll simulate successful operations
  return { 
    canRead: true, 
    canWrite: true, 
    policiesWork: true
  };
};