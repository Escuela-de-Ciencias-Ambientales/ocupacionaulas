import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type OldTrip = {
  id: string;
  trip_photo_path: string | null;
};

export default {
  fetch: withSupabase({ auth: ["secret"] }, async (request, context) => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const adminClient = context.supabase;
    const currentYear = new Date().getUTCFullYear();
    const vehicleCutoff = `${currentYear - 1}-01-01T00:00:00.000Z`;

    const { data: oldTrips, error: selectError } = await adminClient
      .from("vehicle_reservations")
      .select("id,trip_photo_path")
      .lt("ends_at", vehicleCutoff)
      .limit(5000);
    if (selectError) {
      return Response.json({ error: selectError.message }, { status: 500 });
    }

    const trips = (oldTrips || []) as OldTrip[];
    const photoPaths = trips
      .map((trip) => trip.trip_photo_path)
      .filter((path): path is string => Boolean(path));
    for (let index = 0; index < photoPaths.length; index += 100) {
      const { error } = await adminClient.storage
        .from("vehicle-trip-photos")
        .remove(photoPaths.slice(index, index + 100));
      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    const ids = trips.map((trip) => trip.id);
    if (ids.length) {
      const { error } = await adminClient
        .from("vehicle_reservations")
        .delete()
        .in("id", ids);
      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    const { data: classroomDeleted, error: classroomError } =
      await adminClient.rpc("cleanup_old_classroom_reservations");
    if (classroomError) {
      return Response.json({ error: classroomError.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      vehicleCutoff,
      vehicleReservationsDeleted: ids.length,
      vehiclePhotosDeleted: photoPaths.length,
      classroomReservationsDeleted: classroomDeleted || 0
    });
  })
};
