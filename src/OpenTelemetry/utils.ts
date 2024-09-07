import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  name: string;
  version: string;
  [key: string]: any;
}

export function getPackageInfo(): { name: string; version: string } {
  try {
    // Read the package.json file
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');

    // Parse the JSON content
    const packageJson: PackageJson = JSON.parse(packageJsonContent);

    // Extract name and version
    const { name, version } = packageJson;

    return { name, version };
  } catch (error) {
    console.error('Error reading package.json:', error);
    return { name: 'Unknown', version: 'Unknown' };
  }
}
