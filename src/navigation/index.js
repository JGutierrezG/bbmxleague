import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../hooks/useAuth';
import LoginScreen            from '../screens/LoginScreen';
import HomeScreen              from '../screens/HomeScreen';
import ProfileScreen           from '../screens/ProfileScreen';
import CreateTournamentScreen  from '../screens/CreateTournamentScreen';
import PreRegistroScreen       from '../screens/PreRegistroScreen';
import TournamentScreen        from '../screens/TournamentScreen';
import MatchScorerScreen       from '../screens/MatchScorerScreen';

const Stack = createStackNavigator();

export default function Navigation() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Home"            component={HomeScreen} />
            <Stack.Screen name="Profile"         component={ProfileScreen} />
            <Stack.Screen name="CreateTournament" component={CreateTournamentScreen} />
            <Stack.Screen name="PreRegistro"     component={PreRegistroScreen} />
            <Stack.Screen name="Tournament"      component={TournamentScreen} />
            <Stack.Screen name="MatchScorer"     component={MatchScorerScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
