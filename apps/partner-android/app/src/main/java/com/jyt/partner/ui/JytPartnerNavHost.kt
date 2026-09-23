package com.jyt.partner.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Checkroom
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.jyt.partner.AuthViewModel
import com.jyt.partner.push.PushManager

/** Top-level routes — login vs the tabbed partner area, plus detail pushes. */
object Routes {
    const val LOGIN = "login"
    const val MAIN = "main"
    const val ORDER = "order/{orderId}"
    const val RUN = "run/{runId}"
    const val DESIGN = "design/{designId}"
    const val INVENTORY_ORDER = "inventory/{orderId}"

    fun order(id: String) = "order/$id"
    fun run(id: String) = "run/$id"
    fun design(id: String) = "design/$id"
    fun inventoryOrder(id: String) = "inventory/$id"
}

@Composable
fun JytPartnerNavHost(auth: AuthViewModel) {
    val navController = rememberNavController()
    val state by auth.state.collectAsState()

    // A push tap that named a run is honored once the area is up.
    val pendingRunId by PushManager.pendingRunId.collectAsState()
    LaunchedEffect(pendingRunId, state) {
        val runId = pendingRunId ?: return@LaunchedEffect
        if (state is AuthViewModel.State.SignedIn) {
            PushManager.offerPendingRunId(null)
            navController.navigate(Routes.run(runId))
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (state is AuthViewModel.State.SignedIn) Routes.MAIN else Routes.LOGIN,
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(auth = auth)
        }
        composable(Routes.MAIN) {
            MainScaffold(auth = auth, navController = navController)
        }
        composable(Routes.ORDER) { entry ->
            val orderId = entry.arguments?.getString("orderId").orEmpty()
            OrderDetailScreen(
                auth = auth,
                orderId = orderId,
                onOpenRun = { runId -> navController.navigate(Routes.run(runId)) },
                onOpenDesign = { designId -> navController.navigate(Routes.design(designId)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.RUN) { entry ->
            val runId = entry.arguments?.getString("runId").orEmpty()
            RunDetailScreen(
                runId = runId,
                onOpenDesign = { designId -> navController.navigate(Routes.design(designId)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.DESIGN) { entry ->
            val designId = entry.arguments?.getString("designId").orEmpty()
            DesignDetailScreen(
                designId = designId,
                onOpenRun = { runId -> navController.navigate(Routes.run(runId)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.INVENTORY_ORDER) { entry ->
            val orderId = entry.arguments?.getString("orderId").orEmpty()
            InventoryOrderDetailScreen(
                orderId = orderId,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

private enum class Tab(val label: String, val filled: androidx.compose.ui.graphics.vector.ImageVector, val outlined: androidx.compose.ui.graphics.vector.ImageVector) {
    ORDERS("Orders", Icons.Filled.Checkroom, Icons.Outlined.Checkroom),
    INVENTORY("Inventory", Icons.Filled.Inventory2, Icons.Outlined.Inventory2),
    PROFILE("Profile", Icons.Filled.Person, Icons.Outlined.Person),
}

@Composable
private fun MainScaffold(auth: AuthViewModel, navController: androidx.navigation.NavHostController) {
    var selectedTab by androidx.compose.runtime.saveable.rememberSaveable {
        androidx.compose.runtime.mutableStateOf(Tab.ORDERS)
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = tab == selectedTab,
                        onClick = { selectedTab = tab },
                        icon = {
                            Icon(
                                imageVector = if (tab == selectedTab) tab.filled else tab.outlined,
                                contentDescription = tab.label,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        androidx.compose.foundation.layout.Box(modifier = Modifier.padding(padding)) {
            when (selectedTab) {
                Tab.ORDERS -> OrdersScreen(
                    onOpenOrder = { id -> navController.navigate(Routes.order(id)) },
                )
                Tab.INVENTORY -> InventoryOrdersScreen(
                    onOpenOrder = { id -> navController.navigate(Routes.inventoryOrder(id)) },
                )
                Tab.PROFILE -> ProfileScreen(auth = auth)
            }
        }
    }
}
