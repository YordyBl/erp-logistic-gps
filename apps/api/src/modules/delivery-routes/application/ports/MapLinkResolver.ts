export interface MapLinkCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface MapLinkResolver {
  resolve(url: string): Promise<MapLinkCoordinates>;
}
