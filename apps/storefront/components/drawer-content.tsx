import React from "react"
import { StyleSheet, View } from "react-native"
import { DrawerContentScrollView, DrawerContentComponentProps } from "@react-navigation/drawer"
import { RegionSelector } from "./region-selector"
import { ThemeSelector } from "./theme-selector"

export function DrawerContent(props: DrawerContentComponentProps) {
  return (
    <DrawerContentScrollView {...props}>
      <View style={styles.container}>
        <RegionSelector />
        <ThemeSelector />
      </View>
    </DrawerContentScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})
