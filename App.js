import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Animated } from 'react-native';
import ConfigScreen from './src/screens/ConfigScreen';

export default function App() {
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (isFlashing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false, // backgroundColor doesn't support native driver
          }),
          Animated.timing(flashAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          })
        ])
      ).start();
    } else {
      flashAnim.stopAnimation();
      flashAnim.setValue(0);
    }
  }, [isFlashing, flashAnim]);

  const interpolatedColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#f5f5f5', '#ff0000'] // From light grey to bright red
  });

  return (
    <Animated.View style={[styles.container, { backgroundColor: interpolatedColor }]}>
      <ConfigScreen isFlashing={isFlashing} setIsFlashing={setIsFlashing} />
      <StatusBar style="auto" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
