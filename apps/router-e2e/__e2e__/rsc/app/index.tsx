import { View, Text } from '../lib/react-native';

export default function Page() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text testID="main-text">Hey!</Text>
    </View>
  );
}
