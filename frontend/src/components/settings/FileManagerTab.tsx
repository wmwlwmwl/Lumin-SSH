import { SettingsTabRoot } from './SharedComponents';
import FileManagerPreferencesSection from './fileManager/FileManagerPreferencesSection';
import FileManagerConcurrencySection from './fileManager/FileManagerConcurrencySection';
import FileManagerDownloadSection from './fileManager/FileManagerDownloadSection';
import type { FileManagerTabProps } from './fileManager/fileManagerTabTypes';

export type { FileManagerTabProps };

export default function FileManagerTab(props: FileManagerTabProps) {
  return (
    <SettingsTabRoot>
      <FileManagerPreferencesSection {...props} />
      <FileManagerConcurrencySection {...props} />
      <FileManagerDownloadSection {...props} />
    </SettingsTabRoot>
  );
}
