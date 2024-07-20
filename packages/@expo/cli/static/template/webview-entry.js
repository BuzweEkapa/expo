// Generated by Expo CLI
import '@expo/metro-runtime';

import { ActivityIndicator } from 'react-native';
// Add web error box
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { _getActionsObject } from 'expo/webview';
import React from 'react';

const actions = _getActionsObject();

function ActionsWrapper(props) {
  const AppModule = React.useMemo(() => {
    return React.lazy(async () => {
      const AppModule = await import('[$$GENERATED_ENTRY]');

      if (!AppModule) {
        throw new Error('No exports from module: [$$GENERATED_ENTRY]');
      }

      if (!AppModule.default) {
        return {
          default: () =>
            React.createElement(
              'div',
              undefined,
              'Missing default export in module: [$$GENERATED_ENTRY]'
            ),
        };
      }

      return AppModule;
    });
  }, []);

  return (
    <React.Suspense fallback={<ActivityIndicator />}>
      <AppModule {...props} actions={actions} />
    </React.Suspense>
  );
}

renderRootComponent(ActionsWrapper);
