import Stream from 'ts-stream'

// Copyright 2015 gRPC authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// Interface exported by the server.
export interface RouteGuide {
  // A simple RPC.
  //
  // Obtains the feature at a given position.
  //
  // A feature with an empty name is returned if there's no feature at the given
  // position.
getFeature (point: Point): Feature
  // A server-to-client streaming RPC.
  //
  // Obtains the Features available within the given Rectangle.  Results are
  // streamed rather than returned at once (e.g. in a response message with a
  // repeated field), as the rectangle may cover a large area and contain a
  // huge number of features.
listFeatures (rectangle: Rectangle): Stream<Feature>
  // A client-to-server streaming RPC.
  //
  // Accepts a stream of Points on a route being traversed, returning a
  // RouteSummary when traversal is completed.
recordRoute (pointStream: Stream<Point>): RouteSummary
  // A Bidirectional streaming RPC.
  //
  // Accepts a stream of RouteNotes sent while a route is being traversed,
  // while receiving other RouteNotes (e.g. from other users).
routeChat (routeNoteStream: Stream<RouteNote>): Stream<RouteNote>
}
// Points are represented as latitude-longitude pairs in the E7 representation
// (degrees multiplied by 10**7 and rounded to the nearest integer).
// Latitudes should be in the range +/- 90 degrees and longitude should be in
// the range +/- 180 degrees (inclusive).
export interface Point {
latitude?: number
longitude?: number
}
// A latitude-longitude rectangle, represented as two diagonally opposite
// points "lo" and "hi".
export interface Rectangle {
  // One corner of the rectangle.
lo: Point
  // The other corner of the rectangle.
hi?: Point
}
// A feature names something at a given point.
//
// If a feature could not be named, the name is empty.
export interface Feature {
  // The name of the feature.
name?: string
  // The point where the feature is detected.
location?: Point
}
// A RouteNote is a message sent while at a given point.
export interface RouteNote {
  // The location from which the message is sent.
location?: Point
  // The message to be sent.
message?: string[]
}
// A RouteSummary is received in response to a RecordRoute rpc.
//
// It contains the number of individual points received, the number of
// detected features, and the total distance covered as the cumulative sum of
// the distance between each point.
export interface RouteSummary {
  // The number of points received.
pointCount?: number
  // The number of known features passed while traversing the route.
featureCount?: number
  // The distance covered in metres.
distance?: number
  // The duration of the traversal in seconds.
elapsedTime?: number
}