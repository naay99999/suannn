import { useNavigation } from 'react-router'

/** Thin top bar while React Router loads a lazy route; styled by `.navigation-progress` in storefront.css. */
export function NavigationProgress() {
  const navigation = useNavigation()
  return <div aria-hidden="true" className="navigation-progress" data-active={navigation.state !== 'idle' ? '' : undefined} />
}
